package top.dawaatly.contactpicker;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DawaatContactPicker على أندرويد.
 *
 * منتقي النظام في أندرويد (ACTION_PICK) لا يدعم اختياراً متعدداً على أغلب
 * الأجهزة، لذلك الطريق الأساسي هو قراءة جهات الاتصال التي لها رقم (بإذن
 * READ_CONTACTS) وإرجاعها كاملة بنمط "browse"، ليحدّد المستخدم من يريد داخل
 * نافذة دعوات نفسها (تحديد متعدد + بحث). وإن رفض الإذن، يُفتح منتقي النظام
 * لاختيار جهة واحدة — وهذا لا يحتاج أي إذن — بنمط "picked".
 *
 * النتيجة في الحالتين:
 *   { contacts: [{ name, phones: [] }], mode: "browse" | "picked", cancelled?: true }
 */
@CapacitorPlugin(
    name = "DawaatContactPicker",
    permissions = { @Permission(alias = ContactPickerPlugin.CONTACTS_ALIAS, strings = { Manifest.permission.READ_CONTACTS }) }
)
public class ContactPickerPlugin extends Plugin {

    static final String CONTACTS_ALIAS = "contacts";

    @PluginMethod
    public void pickContacts(PluginCall call) {
        if (getPermissionState(CONTACTS_ALIAS) == PermissionState.GRANTED) {
            loadAllContacts(call);
            return;
        }
        requestPermissionForAlias(CONTACTS_ALIAS, call, "contactsPermissionCallback");
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState(CONTACTS_ALIAS) == PermissionState.GRANTED) {
            loadAllContacts(call);
        } else {
            // بلا إذن: منتقي النظام لجهة واحدة (منحة مؤقتة من النظام نفسه)
            openSystemPicker(call);
        }
    }

    // ───────────── القائمة الكاملة (بإذن) — نمط browse ─────────────

    private void loadAllContacts(PluginCall call) {
        // قد تكون القائمة كبيرة، فتُقرأ خارج الخيط الرئيسي
        getBridge()
            .execute(() -> {
                try {
                    JSArray contacts = queryContactsWithPhones();
                    JSObject ret = new JSObject();
                    ret.put("contacts", contacts);
                    ret.put("mode", "browse");
                    call.resolve(ret);
                } catch (SecurityException e) {
                    call.reject("Contacts permission denied", "denied");
                } catch (Exception e) {
                    call.reject("Failed to read contacts: " + e.getMessage(), "failed");
                }
            });
    }

    private JSArray queryContactsWithPhones() {
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER
        };
        String sort = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC";

        // ترتيب الإدراج محفوظ: كل جهة اتصال مرة واحدة مع كل أرقامها
        Map<Long, Entry> byContact = new LinkedHashMap<>();

        try (Cursor cursor = resolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, null, null, sort)) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int nameCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY);
                int numberCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int normalizedCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER);

                while (cursor.moveToNext()) {
                    long id = idCol >= 0 ? cursor.getLong(idCol) : cursor.getPosition();
                    String name = nameCol >= 0 ? cursor.getString(nameCol) : null;
                    String number = numberCol >= 0 ? cursor.getString(numberCol) : null;
                    String normalized = normalizedCol >= 0 ? cursor.getString(normalizedCol) : null;
                    // الرقم الموحّد (E.164) أدق عند توفره، والموقع يوحّد الصيغة مرة أخرى على أي حال
                    String phone = normalized != null && !normalized.trim().isEmpty() ? normalized : number;
                    if (phone == null || phone.trim().isEmpty()) continue;

                    Entry entry = byContact.get(id);
                    if (entry == null) {
                        entry = new Entry(name == null ? "" : name.trim());
                        byContact.put(id, entry);
                    }
                    if (!entry.phones.contains(phone.trim())) {
                        entry.phones.add(phone.trim());
                    }
                }
            }
        }

        JSArray contacts = new JSArray();
        for (Entry entry : byContact.values()) {
            contacts.put(toJs(entry.name, entry.phones));
        }
        return contacts;
    }

    // ───────────── منتقي النظام (بلا إذن) — نمط picked ─────────────

    private void openSystemPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        try {
            // لا نستخدم resolveActivity: على أندرويد 11+ يعيد null بلا <queries>
            startActivityForResult(call, intent, "systemPickerResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No contacts app available", "unsupported");
        }
    }

    @ActivityCallback
    private void systemPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSObject ret = new JSObject();
        ret.put("mode", "picked");
        JSArray contacts = new JSArray();

        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            ret.put("contacts", contacts);
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        String name = "";
        List<String> phones = new ArrayList<>();
        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY);
                int numberCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                if (nameCol >= 0 && cursor.getString(nameCol) != null) name = cursor.getString(nameCol).trim();
                if (numberCol >= 0 && cursor.getString(numberCol) != null) phones.add(cursor.getString(numberCol).trim());
            }
        } catch (Exception e) {
            call.reject("Failed to read the selected contact: " + e.getMessage(), "failed");
            return;
        }

        if (!phones.isEmpty()) {
            contacts.put(toJs(name, phones));
        }
        ret.put("contacts", contacts);
        call.resolve(ret);
    }

    // ───────────────────────────── أدوات ─────────────────────────────

    private static JSObject toJs(String name, List<String> phones) {
        JSObject contact = new JSObject();
        contact.put("name", name == null ? "" : name);
        JSArray numbers = new JSArray();
        for (String phone : phones) {
            numbers.put(phone);
        }
        contact.put("phones", numbers);
        return contact;
    }

    private static final class Entry {

        final String name;
        final List<String> phones = new ArrayList<>();

        Entry(String name) {
            this.name = name;
        }
    }
}
