export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new HttpError(
      response.status,
      typeof data.error === "string"
        ? data.error
        : (data.error?.message ?? "Richiesta non riuscita."),
    );
  return data;
}
export function message(error: unknown) {
  const text =
    error instanceof Error ? error.message : "Operazione non riuscita.";
  if (/user rejected|user denied|rejected the request/i.test(text))
    return "Operazione rifiutata nel wallet. Puoi riprovare.";
  if (/PriceChanged/.test(text))
    return "Il prezzo è cambiato. Richiedi un nuovo preventivo e conferma il totale.";
  if (/QuoteExpired/.test(text))
    return "Preventivo scaduto. Richiedine uno nuovo.";
  if (/insufficient funds/i.test(text))
    return "ETH insufficienti per pagare il gas.";
  if (/ERC20InsufficientBalance/.test(text))
    return "Crediti RCS insufficienti per questo acquisto.";
  if (/InvalidSignature|InvalidPoint/.test(text))
    return "Il punto o la sua autorizzazione sono cambiati. Richiedi un nuovo preventivo.";
  if (/fetch|network|timeout/i.test(text))
    return "Connessione non disponibile. Riprova tra poco.";
  return text.split("\n")[0].slice(0, 220);
}
