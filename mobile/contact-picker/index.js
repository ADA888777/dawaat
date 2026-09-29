/**
 * DawaatContactPicker — واجهة JavaScript للملحق الأصلي.
 *
 * الموقع نفسه (dawaatly.top) لا يستورد هذا الملف؛ فهو يستدعي الملحق عبر الجسر
 * الذي يحقنه Capacitor في الصفحة: window.Capacitor.registerPlugin("DawaatContactPicker").
 * هذا الملف للتوثيق ولأي واجهة مستقبلية تُبنى داخل التطبيق نفسه.
 *
 * pickContacts() → Promise<{
 *   contacts: Array<{ name: string, phones: string[] }>,
 *   mode: "picked" | "browse",   // picked: اختارهم المستخدم في منتقي النظام
 *                                // browse: قائمة جهات الاتصال كاملة للاختيار داخل الموقع
 *   cancelled?: boolean          // أغلق المستخدم المنتقي بلا اختيار
 * }>
 */
import { registerPlugin } from "@capacitor/core";

export const DawaatContactPicker = registerPlugin("DawaatContactPicker");

export default DawaatContactPicker;
