package jp.xtremewalk.app;

import android.Manifest;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Reads the device's hardware step counter (Sensor.TYPE_STEP_COUNTER), which is
 * maintained by a low-power coprocessor and keeps counting while the screen is
 * off or the app is killed. The cumulative since-boot value is converted to a
 * race-relative count using a baseline persisted in SharedPreferences, so the
 * count survives process death.
 */
@CapacitorPlugin(
    name = "XwalkPedometer",
    permissions = {
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION })
    }
)
public class PedometerPlugin extends Plugin implements SensorEventListener {

    private static final String PREFS = "xwalk_pedometer";
    private static final String KEY_BASELINE = "step_baseline";

    private SensorManager sensorManager;
    private Sensor stepSensor;
    private float baseline = -1f;
    private int currentSteps = 0;
    private boolean listening = false;

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (sensorManager == null) {
            sensorManager = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        }
        if (sensorManager != null && stepSensor == null) {
            stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        }
        if (sensorManager == null || stepSensor == null) {
            call.reject("step_counter_unavailable");
            return;
        }

        baseline = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getFloat(KEY_BASELINE, -1f);

        if (!listening) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
            listening = true;
        }

        JSObject ret = new JSObject();
        ret.put("steps", currentSteps);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        unregister();
        call.resolve();
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("steps", currentSteps);
        call.resolve(ret);
    }

    @PluginMethod
    public void resetBaseline(PluginCall call) {
        // Force the next sensor reading to define a fresh zero point (race restart).
        baseline = -1f;
        currentSteps = 0;
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_BASELINE).apply();
        JSObject ret = new JSObject();
        ret.put("steps", 0);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        unregister();
        super.handleOnDestroy();
    }

    private void unregister() {
        if (sensorManager != null && listening) {
            sensorManager.unregisterListener(this);
            listening = false;
        }
    }

    private void persistBaseline(float value) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putFloat(KEY_BASELINE, value).apply();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) {
            return;
        }
        float total = event.values[0];

        // The first reading (or one after resetBaseline) defines the zero point.
        // A reboot resets the hardware counter, so a value below the baseline
        // also re-anchors it rather than producing a negative count.
        if (baseline < 0f || total < baseline) {
            baseline = total;
            persistBaseline(baseline);
        }

        currentSteps = Math.max(0, (int) (total - baseline));

        JSObject ret = new JSObject();
        ret.put("steps", currentSteps);
        notifyListeners("steps", ret);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Not relevant for a step counter.
    }
}
