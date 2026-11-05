package in.brindavan.foundercalls.call

import in.brindavan.foundercalls.data.CallEventEntity
import in.brindavan.foundercalls.data.Direction

/** The one live call the tracking service is working on. */
data class ActiveCall(
    val id: String,
    val direction: Direction,
    val number: String,
    val attemptAt: Long,
)

object CallStateMachine {
    @Volatile var active: ActiveCall? = null
        private set

    fun begin(call: ActiveCall): Boolean {
        if (active != null) return false
        active = call
        return true
    }

    fun clear() { active = null }

    fun entityFrom(call: ActiveCall, deviceId: String, day: String): CallEventEntity =
        CallEventEntity(
            id = call.id,
            deviceId = deviceId,
            direction = call.direction,
            numberE164 = call.number,
            attemptAt = call.attemptAt,
            ringStartAt = if (call.direction == Direction.IN) call.attemptAt else null,
            istDay = day,
        )
}
