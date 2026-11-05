package in.brindavan.foundercalls

import android.app.Application
import in.brindavan.foundercalls.data.AppDatabase
import in.brindavan.foundercalls.data.Prefs
import in.brindavan.foundercalls.data.DeviceTokenStore

class FounderCallsApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

class AppContainer(private val app: Application) {
    val db: AppDatabase by lazy { AppDatabase.build(app) }
    val prefs: Prefs by lazy { Prefs(app) }
    val tokens: DeviceTokenStore by lazy { DeviceTokenStore(app) }
}
