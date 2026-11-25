import oebb from "../lib/oebb.cjs";

export default async (request) => {
  const result = await oebb.handler({ httpMethod: request.method });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
};
