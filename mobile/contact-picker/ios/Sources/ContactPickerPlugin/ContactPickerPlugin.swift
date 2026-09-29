import Foundation
import Capacitor
import Contacts
import ContactsUI

/**
 * DawaatContactPicker على iOS.
 *
 * يفتح منتقي جهات الاتصال الخاص بالنظام (CNContactPickerViewController)
 * باختيار متعدد. المنتقي يعمل خارج عملية التطبيق، فلا يحتاج إذن الوصول
 * لجهات الاتصال ولا مفتاح NSContactsUsageDescription — التطبيق لا يقرأ
 * دفتر العناوين، بل يتسلم فقط من اختاره المستخدم.
 *
 * النتيجة: { contacts: [{ name, phones: [] }], mode: "picked", cancelled?: true }
 */
@objc(ContactPickerPlugin)
public class ContactPickerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContactPickerPlugin"
    public let jsName = "DawaatContactPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickContacts", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var pickerDelegate: PickerDelegate?

    @objc func pickContacts(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller to present the contact picker", "failed")
                return
            }
            if self.pendingCall != nil {
                call.reject("Contact picker is already open", "failed")
                return
            }

            self.pendingCall = call

            let picker = CNContactPickerViewController()
            // لا يُفعَّل إلا من له رقم هاتف، والأرقام هي الخاصية المعروضة
            picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
            picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]

            let delegate = PickerDelegate(
                onSelect: { [weak self] contacts in self?.finish(with: contacts, cancelled: false) },
                onCancel: { [weak self] in self?.finish(with: [], cancelled: true) }
            )
            self.pickerDelegate = delegate
            picker.delegate = delegate

            presenter.present(picker, animated: true, completion: nil)
        }
    }

    private func finish(with contacts: [CNContact], cancelled: Bool) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        pickerDelegate = nil

        var list: [[String: Any]] = []
        let nameKeys = CNContactFormatter.descriptorForRequiredKeys(for: .fullName)
        for contact in contacts {
            guard contact.isKeyAvailable(CNContactPhoneNumbersKey) else { continue }
            let phones = contact.phoneNumbers.map { $0.value.stringValue }
            if phones.isEmpty { continue }

            var name = ""
            if contact.areKeysAvailable([nameKeys]) {
                name = CNContactFormatter.string(from: contact, style: .fullName) ?? ""
            }
            if name.isEmpty {
                name = [contact.givenName, contact.familyName]
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
            }
            if name.isEmpty, contact.isKeyAvailable(CNContactOrganizationNameKey) {
                name = contact.organizationName
            }
            list.append(["name": name, "phones": phones])
        }

        var result: [String: Any] = ["contacts": list, "mode": "picked"]
        if cancelled { result["cancelled"] = true }
        call.resolve(result)
    }
}

/// مفوّض منفصل: تنفيذ didSelect contacts (الجمع) هو ما يفعّل الاختيار المتعدد في iOS
private final class PickerDelegate: NSObject, CNContactPickerDelegate {
    private let onSelect: ([CNContact]) -> Void
    private let onCancel: () -> Void

    init(onSelect: @escaping ([CNContact]) -> Void, onCancel: @escaping () -> Void) {
        self.onSelect = onSelect
        self.onCancel = onCancel
    }

    func contactPicker(_ picker: CNContactPickerViewController, didSelect contacts: [CNContact]) {
        onSelect(contacts)
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        onCancel()
    }
}
