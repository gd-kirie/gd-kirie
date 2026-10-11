package ai.moeru.kirie.android

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle

data class KirieRuntimeConfig(
    val enableWebInspector: Boolean,
    val allowTlsBypass: Boolean,
) {
    companion object {
        private const val META_ENABLE_WEB_INSPECTOR = "ai.moeru.kirie.ENABLE_WEB_INSPECTOR"
        private const val META_ALLOW_TLS_BYPASS = "ai.moeru.kirie.ALLOW_TLS_BYPASS"

        fun from(activity: Activity): KirieRuntimeConfig {
            val metadata = activity.applicationMetadata()
            return KirieRuntimeConfig(
                enableWebInspector = metadata.booleanValue(META_ENABLE_WEB_INSPECTOR),
                allowTlsBypass = metadata.booleanValue(META_ALLOW_TLS_BYPASS),
            )
        }

        private fun Bundle?.booleanValue(key: String): Boolean = this?.getBoolean(key, false) ?: false

        private fun Activity.applicationMetadata() =
            try {
                applicationInfoWithMetadata().metaData
            } catch (_: PackageManager.NameNotFoundException) {
                null
            }

        private fun Activity.applicationInfoWithMetadata(): ApplicationInfo =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getApplicationInfo(
                    packageName,
                    PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
                )
            } else {
                // Android versions before 13 require the deprecated int flags overload.
                @Suppress("DEPRECATION")
                packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            }
    }
}
