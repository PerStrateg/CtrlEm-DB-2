export async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
