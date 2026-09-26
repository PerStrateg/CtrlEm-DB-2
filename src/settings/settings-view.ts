import { credentialFields } from '../shared/credentials-protocol';
import type { CredentialId, Credentials } from '../shared/credentials-protocol';

export interface CredentialsClient {
  load(): Promise<Credentials>;
  save(field: CredentialId, value: string): Promise<void>;
}

export async function mountSettings(document: Document, client: CredentialsClient): Promise<void> {
  const root = document.querySelector('main')!;
  const loading = document.createElement('p');
  loading.setAttribute('role', 'status');
  loading.textContent = 'Loading settings…';
  root.append(loading);
  let values: Credentials;
  try { values = await client.load(); }
  catch {
    loading.textContent = 'Couldn’t load settings. Retry to keep your saved values.';
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => { loading.remove(); retry.remove(); void mountSettings(document, client); };
    root.append(retry);
    return;
  }
  loading.remove();
  for (const field of credentialFields) {
    const section = document.createElement('section');
    const label = document.createElement('label');
    label.htmlFor = field.id;
    label.textContent = field.label;
    const help = document.createElement('p');
    help.id = `${field.id}-help`;
    help.textContent = field.description;
    if ('link' in field) {
      const link = document.createElement('a');
      link.textContent = field.link.label;
      link.href = field.link.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      help.append(' ', link);
    }
    const input = document.createElement('input');
    input.id = field.id;
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = values[field.id];
    input.setAttribute('aria-describedby', help.id);
    const show = document.createElement('button');
    show.textContent = 'Show';
    show.setAttribute('aria-label', `Show ${field.label}`);
    show.onclick = () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      show.textContent = input.type === 'password' ? 'Show' : 'Hide';
      show.setAttribute('aria-label', `${show.textContent} ${field.label}`);
    };
    let saving = false;
    let revision = 0;
    const save = async () => {
      if (saving) return;
      saving = true;
      const current = revision;
      try {
        await client.save(field.id, input.value);
      } catch {
        // Keep the edit in the field; the next edit attempts persistence again.
      } finally {
        saving = false;
        if (current !== revision) void save();
      }
    };
    input.oninput = () => { revision++; void save(); };
    section.append(label, help, input, show);
    root.append(section);
  }
}
