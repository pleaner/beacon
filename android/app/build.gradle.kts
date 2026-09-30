plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun prop(name: String) = (project.findProperty(name) as String?).orEmpty()

android {
    namespace = "za.org.sarza.guardian"
    compileSdk = 35

    defaultConfig {
        applicationId = "za.org.sarza.guardian"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
        buildConfigField("String", "API_URL", "\"${prop("guardianUrl")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${prop("firebaseAppId")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${prop("firebaseApiKey")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${prop("firebaseProjectId")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${prop("firebaseSenderId")}\"")
        // Plain http only when pointing at a local dev server.
        manifestPlaceholders["cleartext"] = prop("guardianUrl").startsWith("http://").toString()
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}
