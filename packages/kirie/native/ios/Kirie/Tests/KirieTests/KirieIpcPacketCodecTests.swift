import Foundation
import XCTest

final class KirieIpcPacketCodecTests: XCTestCase {
    func testTextLaneUsesCborTextString() throws {
        let packet = KirieIpcPacketCodec.encodeText("kirie:cbor")

        XCTAssertEqual(packet.kirieHexString, "6a6b697269653a63626f72")
        XCTAssertEqual(try KirieIpcPacketCodec.decodeText(packet), "kirie:cbor")
    }

    func testBinaryLaneUsesCborByteString() throws {
        let bytes = Data([0, 1, 2, 127, 128, 255])
        let packet = KirieIpcPacketCodec.encodeBinary(bytes)

        XCTAssertEqual(packet.kirieHexString, "460001027f80ff")
        XCTAssertEqual(try KirieIpcPacketCodec.decodeBinary(packet), bytes)
    }

    func testDataLaneUsesCborDataItemSubset() throws {
        let value = KirieIpcValue.array([
            .string("kirie-cbor"),
            .int(42),
            .null,
            .map(["lane": .string("data")]),
            .double(1.5),
            .bool(true),
            .bool(false),
            .int(-1),
        ])

        let packet = KirieIpcPacketCodec.encodeData(value)

        XCTAssertEqual(
            packet.kirieHexString,
            "886a6b697269652d63626f72182af6a1646c616e656464617461f93e00f5f420"
        )
        XCTAssertEqual(try KirieIpcPacketCodec.decodeData(packet), value)
    }

    func testDataLaneEncodesFloatsInShortestExactForm() {
        XCTAssertEqual(KirieIpcPacketCodec.encodeData(.double(1.5)).kirieHexString, "f93e00")
        XCTAssertEqual(KirieIpcPacketCodec.encodeData(.double(100_000)).kirieHexString, "fa47c35000")
        XCTAssertEqual(KirieIpcPacketCodec.encodeData(.double(0.1)).kirieHexString, "fb3fb999999999999a")
    }

    func testDataLaneDecodesEveryFloatWidth() throws {
        // The web side (cborg with float64) always sends 8-byte doubles.
        for hex in ["f93e00", "fa3fc00000", "fb3ff8000000000000"] {
            XCTAssertEqual(try KirieIpcPacketCodec.decodeData(Data(kirieHex: hex)), .double(1.5), hex)
        }
    }

    func testDataLaneRejectsTrailingBytes() {
        XCTAssertThrowsError(try KirieIpcPacketCodec.decodeData(Data(kirieHex: "fb3ff800000000000000"))) { error in
            XCTAssertEqual(error as? KirieCborError, .trailingBytes)
        }
    }
}

private extension Data {
    init(kirieHex hex: String) {
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            bytes.append(UInt8(hex[index ..< next], radix: 16) ?? 0)
            index = next
        }
        self.init(bytes)
    }

    var kirieHexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
