package com.dreamcabs.customer;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.phone.SmsRetriever;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsConsentPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @CapacitorPlugin(name = "SmsConsent")
    public static class SmsConsentPlugin extends Plugin {
        private BroadcastReceiver smsReceiver = null;
        private static final Pattern OTP_PATTERN = Pattern.compile("(?<!\\d)\\d{6}(?!\\d)");

        private PluginCall savedCall = null;

        @PluginMethod
        public void startListening(PluginCall call) {
            try {
                stopListeningInternal();
                this.savedCall = call;

                SmsRetriever.getClient(getContext())
                    .startSmsUserConsent(null)
                    .addOnSuccessListener(aVoid -> {
                        // Successfully started listening for SMS
                    })
                    .addOnFailureListener(e -> {
                        // Failed to start SMS Retriever
                    });

                IntentFilter intentFilter = new IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION);
                smsReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        if (SmsRetriever.SMS_RETRIEVED_ACTION.equals(intent.getAction())) {
                            Bundle extras = intent.getExtras();
                            if (extras != null) {
                                Status status = (Status) extras.get(SmsRetriever.EXTRA_STATUS);
                                if (status != null && status.getStatusCode() == CommonStatusCodes.SUCCESS) {
                                    Intent consentIntent = extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT);
                                    if (consentIntent != null) {
                                        try {
                                            startActivityForResult(call, consentIntent, "handleSmsConsentResult");
                                        } catch (Exception e) {
                                            // Handle exception
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    getContext().registerReceiver(smsReceiver, intentFilter, Context.RECEIVER_EXPORTED);
                } else {
                    getContext().registerReceiver(smsReceiver, intentFilter);
                }

                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to start SMS consent: " + e.getMessage());
            }
        }

        @ActivityCallback
        private void handleSmsConsentResult(PluginCall call, ActivityResult result) {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                String message = result.getData().getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE);
                if (message != null) {
                    String code = extractOtp(message);
                    JSObject event = new JSObject();
                    event.put("code", code != null ? code : "");
                    event.put("message", message);
                    notifyListeners("onSmsReceived", event);
                    return;
                }
            }
        }

        @PluginMethod
        public void stopListening(PluginCall call) {
            stopListeningInternal();
            call.resolve();
        }

        private void stopListeningInternal() {
            if (smsReceiver != null) {
                try {
                    getContext().unregisterReceiver(smsReceiver);
                } catch (Exception ignored) {}
                smsReceiver = null;
            }
        }

        @Override
        protected void handleOnDestroy() {
            stopListeningInternal();
            super.handleOnDestroy();
        }

        private String extractOtp(String message) {
            if (message == null) return null;
            Matcher matcher = OTP_PATTERN.matcher(message);
            if (matcher.find()) {
                return matcher.group(0);
            }
            return null;
        }
    }
}
