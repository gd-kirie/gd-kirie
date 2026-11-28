import Foundation
import SwiftCBOR

// Errors that SwiftCBOR doesn't already cover
enum KirieCborError: Error, Equatable {
    case integerOutOfRange
    case nonStringMapKey
    case trailingBytes
    case unexpectedType
}

enum KirieIpcValue: Equatable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([KirieIpcValue])
    case map([String: KirieIpcValue])
}

enum KirieIpcPacketCodec {

    static func encodeText(_ message: String) -> Data {
        Data(CBOR.utf8String(message).encode())
    }

    static func decodeText(_ packet: Data) throws -> String {
        guard case let .utf8String(message) = try decodeSingleCBOR(packet) else {
            throw KirieCborError.unexpectedType
        }
        return message
    }

    static func encodeBinary(_ bytes: Data) -> Data {
        Data(CBOR.byteString([UInt8](bytes)).encode())
    }

    static func decodeBinary(_ packet: Data) throws -> Data {
        guard case let .byteString(bytes) = try decodeSingleCBOR(packet) else {
            throw KirieCborError.unexpectedType
        }
        return Data(bytes)
    }

    static func encodeData(_ value: KirieIpcValue) -> Data {
        Data(cborFrom(value).encode())
    }

    static func decodeData(_ packet: Data) throws -> KirieIpcValue {
        try valueFrom(decodeSingleCBOR(packet))
    }

    private static func cborFrom(_ value: KirieIpcValue) -> CBOR {
        switch value {
        case .null:
            return .null
        case let .bool(booleanValue):
            return .boolean(booleanValue)
        case let .int(integerValue):
            // CBOR major type 0 (unsigned) or 1 (negative).
            // negativeInt(n) encodes as -1 - n, matching the CBOR spec.
            return integerValue >= 0
                ? .unsignedInt(UInt64(integerValue))
                : .negativeInt(UInt64(-(integerValue + 1)))
        case let .double(doubleValue):
            // SwiftCBOR encodes doubles in RFC 8949 preferred (shortest exact)
            // form, so 1.5 becomes a half-precision float (0xf9 prefix).
            return .double(doubleValue)
        case let .string(stringValue):
            return .utf8String(stringValue)
        case let .array(arrayValue):
            return .array(arrayValue.map(cborFrom))
        case let .map(dictionaryValue):
            // Encode with sorted keys so output is deterministic.
            var cborMap: [CBOR: CBOR] = [:]
            for key in dictionaryValue.keys.sorted() {
                cborMap[.utf8String(key)] = cborFrom(dictionaryValue[key] ?? .null)
            }
            return .map(cborMap)
        }
    }

    private static func valueFrom(_ cbor: CBOR) throws -> KirieIpcValue {
        switch cbor {
        case .null:
            return .null

        case let .boolean(booleanValue):
            return .bool(booleanValue)

        case let .unsignedInt(unsignedValue):
            return try valueFromUnsignedInt(unsignedValue)

        case let .negativeInt(unsignedValue):
            return try valueFromNegativeInt(unsignedValue)

        case .double, .half, .float:
            return decodeFloatingPoint(cbor)

        case let .utf8String(stringValue):
            return .string(stringValue)

        case let .array(arrayValue):
            return try valueFromArray(arrayValue)

        case let .map(mapValue):
            return try valueFromMap(mapValue)

        default:
            throw KirieCborError.unexpectedType
        }
    }

    private static func decodeFloatingPoint(_ cbor: CBOR) -> KirieIpcValue {
        switch cbor {
        case let .double(doubleValue):
            return .double(doubleValue)

        case let .half(floatValue):
            return .double(Double(floatValue))

        case let .float(floatValue):
            return .double(Double(floatValue))

        default:
            fatalError("Expected floating-point CBOR value")
        }
    }

    private static func valueFromUnsignedInt(_ unsignedValue: UInt64) throws -> KirieIpcValue {
        guard unsignedValue <= UInt64(Int64.max) else {
            throw KirieCborError.integerOutOfRange
        }
        return .int(Int64(unsignedValue))
    }

    private static func valueFromNegativeInt(_ unsignedValue: UInt64) throws -> KirieIpcValue {
        guard unsignedValue <= UInt64(Int64.max) else {
            throw KirieCborError.integerOutOfRange
        }
        return .int(-1 - Int64(unsignedValue))
    }

    private static func valueFromArray(_ arrayValue: [CBOR]) throws -> KirieIpcValue {
        try .array(arrayValue.map(valueFrom))
    }

    private static func valueFromMap(_ mapValue: [CBOR: CBOR]) throws -> KirieIpcValue {
        var result: [String: KirieIpcValue] = [:]

        for (keyCbor, valueCbor) in mapValue {
            guard case let .utf8String(key) = keyCbor else {
                throw KirieCborError.nonStringMapKey
            }
            result[key] = try valueFrom(valueCbor)
        }

        return .map(result)
    }

    /// Decodes exactly one CBOR data item from `packet`, rejecting trailing bytes.
    private static func decodeSingleCBOR(_ packet: Data) throws -> CBOR {
        let stream = KirieCborInputStream(bytes: [UInt8](packet))
        let decoder = CBORDecoder(stream: stream)

        guard let cbor = try decoder.decodeItem() else {
            // Empty input — no item to decode.
            throw KirieCborError.unexpectedType
        }

        // Count consumed bytes instead of re-encoding: peers may send floats
        // in a different width than SwiftCBOR's shortest-form encoding.
        guard stream.isAtEnd else {
            throw KirieCborError.trailingBytes
        }

        return cbor
    }
}

/// Byte stream that remembers how far the decoder has read.
private final class KirieCborInputStream: CBORInputStream {
    private let bytes: [UInt8]
    private var offset = 0

    init(bytes: [UInt8]) {
        self.bytes = bytes
    }

    var isAtEnd: Bool {
        offset == bytes.count
    }

    func popByte() throws -> UInt8 {
        guard offset < bytes.count else {
            throw CBORError.unfinishedSequence
        }
        let byte = bytes[offset]
        offset += 1
        return byte
    }

    func popBytes(_ count: Int) throws -> ArraySlice<UInt8> {
        guard count >= 0, bytes.count - offset >= count else {
            throw CBORError.unfinishedSequence
        }
        let slice = bytes[offset ..< offset + count]
        offset += count
        return slice
    }
}

extension KirieIpcValue {
    static func fromFoundationObject(_ object: Any) throws -> KirieIpcValue {
        if object is NSNull {
            return .null
        }

        if let stringValue = object as? String {
            return .string(stringValue)
        }

        if let numberValue = object as? NSNumber {
            if CFGetTypeID(numberValue) == CFBooleanGetTypeID() {
                return .bool(numberValue.boolValue)
            }

            switch CFNumberGetType(numberValue) {
            case .float32Type, .float64Type, .floatType, .doubleType, .cgFloatType:
                return .double(numberValue.doubleValue)
            default:
                return .int(numberValue.int64Value)
            }
        }

        if let arrayValue = object as? [Any] {
            return try .array(arrayValue.map(fromFoundationObject))
        }

        if let dictionaryValue = object as? [String: Any] {
            var values: [String: KirieIpcValue] = [:]
            for (key, value) in dictionaryValue {
                values[key] = try fromFoundationObject(value)
            }
            return .map(values)
        }

        throw KirieCborError.unexpectedType
    }

    var foundationObject: Any {
        switch self {
        case .null:
            return NSNull()
        case let .bool(value):
            return NSNumber(value: value)
        case let .int(value):
            return NSNumber(value: value)
        case let .double(value):
            return NSNumber(value: value)
        case let .string(value):
            return value
        case let .array(value):
            return value.map(\.foundationObject)
        case let .map(value):
            var dictionary: [String: Any] = [:]
            for (key, item) in value {
                dictionary[key] = item.foundationObject
            }
            return dictionary
        }
    }
}
