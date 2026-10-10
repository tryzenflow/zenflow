/** OS notification APIs: permission is granted, nothing is scheduled or presented. */
export const getPermissionsAsync = async () => ({ status: "granted", granted: true, canAskAgain: true });
export const requestPermissionsAsync = getPermissionsAsync;
export const getExpoPushTokenAsync = async () => ({ data: "ExponentPushToken[test]" });
export const getDevicePushTokenAsync = async () => ({ data: "device-token", type: "fcm" });
export const setNotificationHandler = () => {};
export const addNotificationReceivedListener = () => ({ remove() {} });
export const addNotificationResponseReceivedListener = () => ({ remove() {} });
export const setNotificationChannelAsync = async () => {};
export const scheduleNotificationAsync = async () => "id";
export const dismissNotificationAsync = async () => {};
export const setBadgeCountAsync = async () => true;
export const AndroidImportance = { MAX: 5, HIGH: 4, DEFAULT: 3 };
