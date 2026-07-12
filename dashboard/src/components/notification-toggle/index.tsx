import { ToggleButton } from "@uiid/design-system";
import { Bell, BellOff } from "@uiid/icons";

import { useNotificationSetting } from "../../lib/use-notification-setting";

export const NotificationToggle = () => {
  const { enabled, setEnabled } = useNotificationSetting();

  const handleChange = async (next: boolean) => {
    setEnabled(next);
    if (!next) return;

    // The click is a user gesture — the ideal moment to prompt.
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }

    if (permission === "granted") {
      // Instant proof the OS delivery path works, without waiting for a
      // session to change status.
      new Notification("bertrand notifications on", {
        body: "You'll be alerted when a session needs you.",
      });
    } else {
      // Browsers won't re-prompt after a denial — the user must clear it in
      // site settings (the icon left of the address bar → Notifications).
      window.alert(
        "Notifications are blocked for this site. Click the icon left of the address bar → Site settings → allow Notifications, then reload.",
      );
    }
  };

  return (
    <ToggleButton
      pressed={enabled}
      onPressedChange={handleChange}
      variant={enabled ? undefined : "subtle"}
      size="small"
      aria-label={enabled ? "Disable notifications" : "Enable notifications"}
      tooltip={enabled ? "Notifications on" : "Notifications off"}
      icon={{ pressed: <Bell />, unpressed: <BellOff /> }}
    />
  );
};
NotificationToggle.displayName = "NotificationToggle";
