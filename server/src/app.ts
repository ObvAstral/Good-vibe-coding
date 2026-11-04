import Fastify from "fastify";
import {
  ApiError,
  TerminalService,
  type DepositInput,
  type CartItem,
} from "./service.js";
import { getAddress, maxUint256, zeroAddress, type Address } from "viem";
import { json } from "@riciclo/shared";
const id = { type: "string", pattern: "^[1-9][0-9]{0,77}$" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const uuid = {
  type: "string",
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
};
function validateId(value: string) {
  if (BigInt(value) > maxUint256)
    throw new ApiError(400, "InvalidId", "ID fuori intervallo uint256.");
}
function validateAddress(value: string) {
  try {
    if (getAddress(value) === zeroAddress) throw new Error("zero");
  } catch {
    throw new ApiError(400, "InvalidAddress", "Indirizzo wallet non valido.");
  }
}
export function createApp(service: TerminalService, logger = false) {
  const app = Fastify({
    logger,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.setReplySerializer(json);
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { validation?: unknown };
    if (error instanceof ApiError)
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    if (err.validation)
      return reply
        .status(400)
        .send({
          error: {
            code: "InvalidInput",
            message:
              "Richiesta non valida: controllare indirizzi, quantità e identificativi.",
          },
        });
    request.log.error({ err }, "Errore API");
    return reply
      .status(503)
      .send({
        error: {
          code: "ServiceUnavailable",
          message: "Servizio temporaneamente non disponibile. Riprovare.",
        },
      });
  });
  app.get("/api/config", () => service.config());
  app.get("/api/health", () => ({ status: "ok" }));
  app.post<{ Body: DepositInput }>(
    "/api/deposits",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipient", "machineId", "bottles", "requestId"],
          properties: {
            recipient: address,
            machineId: id,
            bottles: { type: "integer", minimum: 1, maximum: 100 },
            requestId: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      validateId(request.body.machineId);
      validateAddress(request.body.recipient);
      const result = await service.deposit(request.body);
      return reply
        .status(
          result.status === "failed"
            ? 422
            : result.status === "confirmed"
              ? 200
              : 202,
        )
        .send(result);
    },
  );
  app.get<{ Params: { requestId: string } }>(
    "/api/deposits/:requestId",
    {
      schema: {
        params: {
          type: "object",
          required: ["requestId"],
          properties: { requestId: uuid },
        },
      },
    },
    (request) => service.depositStatus(request.params.requestId),
  );
  app.post<{ Body: { buyer: Address; storeId: string; cart: CartItem[] } }>(
    "/api/purchase-quotes",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["buyer", "storeId", "cart"],
          properties: {
            buyer: address,
            storeId: id,
            cart: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["productId", "quantity"],
                properties: {
                  productId: id,
                  quantity: { type: "integer", minimum: 1, maximum: 100 },
                },
              },
            },
          },
        },
      },
    },
    (request) => {
      validateAddress(request.body.buyer);
      validateId(request.body.storeId);
      request.body.cart.forEach((item) => validateId(item.productId));
      return service.quote(
        request.body.buyer,
        request.body.storeId,
        request.body.cart,
      );
    },
  );
  return app;
}
