type SignPayload = Record<string, unknown>;

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class SignJWT {
  private payload: SignPayload;
  private expiresInSeconds = 0;
  private issuedAt = Math.floor(Date.now() / 1000);

  constructor(payload: SignPayload) {
    this.payload = payload;
  }

  setProtectedHeader(header: Record<string, unknown>) {
    void header;
    return this;
  }

  setIssuedAt() {
    this.issuedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setExpirationTime(value: string) {
    const match = /^(\d+)s$/.exec(value);
    this.expiresInSeconds = match ? Number.parseInt(match[1], 10) : 0;
    return this;
  }

  async sign(secret: Uint8Array) {
    void secret;
    const payload = {
      ...this.payload,
      iat: this.issuedAt,
      exp: this.issuedAt + this.expiresInSeconds,
    };

    return `${base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64UrlEncode(JSON.stringify(payload))}.mock`;
  }
}

export async function jwtVerify(token: string, secret: Uint8Array) {
  void secret;
  const [, encodedPayload] = token.split(".");
  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  return { payload };
}
