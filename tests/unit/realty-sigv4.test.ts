import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYLOAD_SHA256,
  encodeCanonicalPath,
  signRequest,
  signingKey,
} from "@/server/storage/sigv4";

/**
 * Vector de prueba OFICIAL de AWS para SigV4 ("Example: GET Object", Amazon
 * S3 Developer Guide — mismo algoritmo que implementa R2): credenciales,
 * canonical request y firma tal cual los publica AWS, para que el firmado a
 * mano de `sigv4.ts` no dependa de "se ve bien".
 * https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
 */
const AWS_VECTOR = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
  amzDate: "20130524T000000Z",
  host: "examplebucket.s3.amazonaws.com",
  expectedCanonicalRequest: [
    "GET",
    "/test.txt",
    "",
    "host:examplebucket.s3.amazonaws.com",
    "range:bytes=0-9",
    `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
    "x-amz-date:20130524T000000Z",
    "",
    "host;range;x-amz-content-sha256;x-amz-date",
    EMPTY_PAYLOAD_SHA256,
  ].join("\n"),
  expectedAuthorization:
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request," +
    "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date," +
    "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
};

describe("signRequest — vector oficial de AWS (GET Object)", () => {
  const result = signRequest({
    method: "GET",
    host: AWS_VECTOR.host,
    canonicalPath: "/test.txt",
    headers: {
      range: "bytes=0-9",
      "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
      "x-amz-date": AWS_VECTOR.amzDate,
    },
    payloadHashHex: EMPTY_PAYLOAD_SHA256,
    accessKeyId: AWS_VECTOR.accessKeyId,
    secretAccessKey: AWS_VECTOR.secretAccessKey,
    region: AWS_VECTOR.region,
    service: AWS_VECTOR.service,
    amzDate: AWS_VECTOR.amzDate,
  });

  it("arma exactamente el canonical request del vector", () => {
    expect(result.canonicalRequest).toBe(AWS_VECTOR.expectedCanonicalRequest);
  });

  it("firma exactamente el authorization header del vector", () => {
    expect(result.authorization).toBe(AWS_VECTOR.expectedAuthorization);
  });

  it("el scope de credenciales es fecha/región/servicio/aws4_request", () => {
    expect(result.credentialScope).toBe("20130524/us-east-1/s3/aws4_request");
  });
});

describe("signingKey", () => {
  it("es determinista: mismas entradas, misma llave", () => {
    const a = signingKey(AWS_VECTOR.secretAccessKey, "20130524", "us-east-1", "s3");
    const b = signingKey(AWS_VECTOR.secretAccessKey, "20130524", "us-east-1", "s3");
    expect(a.equals(b)).toBe(true);
  });

  it("una región distinta produce una llave distinta", () => {
    const a = signingKey(AWS_VECTOR.secretAccessKey, "20130524", "us-east-1", "s3");
    const b = signingKey(AWS_VECTOR.secretAccessKey, "20130524", "auto", "s3");
    expect(a.equals(b)).toBe(false);
  });
});

describe("encodeCanonicalPath", () => {
  it("no codifica las barras que separan segmentos", () => {
    expect(encodeCanonicalPath("/org/org_1/properties/prop_1/ph_1.jpg")).toBe(
      "/org/org_1/properties/prop_1/ph_1.jpg"
    );
  });

  it("codifica caracteres especiales DENTRO de un segmento", () => {
    expect(encodeCanonicalPath("/bucket/a b.jpg")).toBe("/bucket/a%20b.jpg");
  });
});
