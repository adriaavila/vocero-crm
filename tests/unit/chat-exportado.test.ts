import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  adivinarNegocio,
  autoresDelChat,
  condensarChats,
  leerChatExportado,
  taparDatosDelCliente,
} from "@/lib/chat-exportado";
import { textosDelZip } from "@/lib/zip-texto";

const IPHONE = [
  "[12/10/24, 15:03:22] Clínica Sonrisa: ‎Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "[12/10/24, 15:03:22] María López: Hola, ¿cuánto cuesta la limpieza?",
  "[12/10/24, 15:04:10] Clínica Sonrisa: ¡Hola María! 😊 La limpieza cuesta $600.",
  "Incluye revisión.",
  "[12/10/24, 15:05:00] María López: ‎imagen omitida",
  "[12/10/24, 15:06:00] María López: Mi número es +52 55 1234 5678 y mi correo maria@correo.com",
].join("\n");

const ANDROID = [
  "12/10/24, 3:03 p. m. - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "12/10/24, 3:04 p. m. - Juan: ¿Atienden sábados?",
  "12/10/24, 3:05 p. m. - Clínica Sonrisa: Sí, de 9 a 2.",
  "12/10/24, 3:06 p. m. - Juan: <Multimedia omitido>",
].join("\n");

describe("«Desde tus chats»: leer un chat exportado", () => {
  it("lee el formato del iPhone, junta los renglones y quita lo omitido", () => {
    const mensajes = leerChatExportado(IPHONE);
    expect(mensajes.map((m) => m.autor)).toEqual(["Clínica Sonrisa", "María López", "Clínica Sonrisa", "María López"]);
    expect(mensajes[2]?.texto).toBe("¡Hola María! 😊 La limpieza cuesta $600.\nIncluye revisión.");
  });

  it("lee el de Android y deja fuera los avisos del sistema", () => {
    const mensajes = leerChatExportado(ANDROID);
    expect(mensajes).toEqual([
      { autor: "Juan", texto: "¿Atienden sábados?" },
      { autor: "Clínica Sonrisa", texto: "Sí, de 9 a 2." },
    ]);
  });

  it("con dos chats sabe quién es el negocio; con uno, no adivina", () => {
    const a = leerChatExportado(IPHONE);
    const b = leerChatExportado(ANDROID);
    expect(adivinarNegocio([a, b])).toBe("Clínica Sonrisa");
    expect(adivinarNegocio([a])).toBeNull();
    expect(autoresDelChat(a)[0]).toBe("Clínica Sonrisa");
  });

  it("lo que viaja no lleva nombres, teléfonos ni correos de clientes", () => {
    const texto = condensarChats([leerChatExportado(IPHONE), leerChatExportado(ANDROID)], "Clínica Sonrisa");
    expect(texto).toContain("Negocio: ¡Hola [cliente]! 😊 La limpieza cuesta $600. Incluye revisión.");
    expect(texto).toContain("Cliente: ¿Atienden sábados?");
    expect(texto).not.toMatch(/María|Juan|maria@|1234/);
    expect(texto).toContain("---");
  });

  it("se queda con lo más reciente cuando no cabe todo", () => {
    const largo = Array.from({ length: 400 }, (_, i) => `[1/1/24, 10:${String(i % 60).padStart(2, "0")}] ${i % 2 ? "Tienda" : "Ana"}: mensaje ${i}`).join("\n");
    const texto = condensarChats([leerChatExportado(largo)], "Tienda", 500);
    expect(texto.length).toBeLessThanOrEqual(500);
    expect(texto).toContain("mensaje 399");
    expect(texto).not.toContain("mensaje 1\n");
  });

  it("un chat donde el negocio no habla no sirve", () => {
    expect(condensarChats([leerChatExportado(ANDROID)], "Otro")).toBe("");
  });

  it("tapa datos de contacto pero deja los precios", () => {
    expect(taparDatosDelCliente("Llámame al 55 1234 5678, pago $1,500")).toBe("Llámame al [teléfono], pago $1,500");
  });
});

/** Un zip mínimo con un archivo comprimido, como el que entrega el iPhone. */
function zip(nombre: string, contenido: string): ArrayBuffer {
  const datos = deflateRawSync(Buffer.from(contenido, "utf8"));
  const name = Buffer.from(nombre);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(datos.length, 20);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const inicioCentral = local.length + name.length + datos.length;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length + name.length, 12);
  fin.writeUInt32LE(inicioCentral, 16);
  const todo = Buffer.concat([local, name, datos, central, name, fin]);
  return todo.buffer.slice(todo.byteOffset, todo.byteOffset + todo.length);
}

describe("«Desde tus chats»: el .zip del iPhone", () => {
  it("saca el _chat.txt de adentro", async () => {
    expect(await textosDelZip(zip("_chat.txt", IPHONE))).toEqual([IPHONE]);
  });
  it("algo que no es zip no rompe", async () => {
    expect(await textosDelZip(new TextEncoder().encode("hola").buffer as ArrayBuffer)).toBeNull();
  });
});
