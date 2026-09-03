/**
 * Thin wrapper around the browser Contact Picker API.
 *
 * Support is limited (mainly Chrome/Edge on Android, Safari iOS 14.5+ behind a
 * flag on some versions) so callers must feature-detect via
 * `isContactPickerSupported()` and keep manual entry as the primary path.
 *
 * If the project is later wrapped as a native Android/iOS app, replace this
 * with native contacts access (e.g. expo-contacts / Capacitor Contacts) behind
 * the same `PickedContact` interface.
 */

export interface PickedContact {
  name: string;
  phone: string;
}

interface ContactsManagerLike {
  select(
    properties: string[],
    options?: { multiple?: boolean },
  ): Promise<Array<{ name?: string[]; tel?: string[] }>>;
}

function getContactsManager(): ContactsManagerLike | null {
  const nav = navigator as Navigator & { contacts?: ContactsManagerLike };
  return typeof nav.contacts?.select === "function" ? nav.contacts : null;
}

export function isContactPickerSupported(): boolean {
  return getContactsManager() !== null;
}

/**
 * Open the device contact picker (multiple selection) and return normalized
 * name/phone pairs. Returns an empty array if the user cancels.
 * Throws if the API is unsupported or the browser rejects the call.
 */
export async function pickContacts(): Promise<PickedContact[]> {
  const contacts = getContactsManager();
  if (!contacts) {
    throw new Error("Contact Picker API is not supported in this browser");
  }

  let selected: Array<{ name?: string[]; tel?: string[] }>;
  try {
    selected = await contacts.select(["name", "tel"], { multiple: true });
  } catch (err) {
    // User cancelled the picker — a normal outcome, not an error.
    if (err instanceof DOMException && err.name === "AbortError") {
      return [];
    }
    throw err;
  }

  return selected
    .map((c) => ({
      name: (c.name?.[0] ?? "").trim(),
      phone: (c.tel?.[0] ?? "").replace(/[\s-]/g, "").trim(),
    }))
    .filter((c) => c.name !== "" && c.phone !== "");
}
