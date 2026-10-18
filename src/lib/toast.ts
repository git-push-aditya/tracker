// Lets code outside the React tree (query/mutation error handlers) show the dashboard toast.
const EVENT = "pc-toast";
export const emitToast = (msg: string) => dispatchEvent(new CustomEvent(EVENT, { detail: msg }));
export function onToast(cb: (msg: string) => void) {
  const h = (e: Event) => cb((e as CustomEvent<string>).detail);
  addEventListener(EVENT, h);
  return () => removeEventListener(EVENT, h);
}
