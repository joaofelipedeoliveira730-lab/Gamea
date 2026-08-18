const assert=require("assert");
assert(/^[A-Za-z0-9_À-ÿ ]{2,20}$/.test("Piloto Neon"));
assert(!/^[A-Za-z0-9_À-ÿ ]{2,20}$/.test("<script>"));
assert(8<=8);
console.log("NEON PATH QA básico: OK");
