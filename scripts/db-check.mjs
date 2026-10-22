// npm run dev ở terminal khác trước khi chạy npm run db:check.
const services = [
  { name: "lis", port: process.env.LIS_PORT ?? "3101" },
  { name: "middleware", port: process.env.MIDDLEWARE_PORT ?? "3102" },
  { name: "emr", port: process.env.EMR_PORT ?? "3103" },
];

let failures = 0;
for (const service of services) {
  const url = `http://127.0.0.1:${service.port}/ready`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const data = await response.json();
    const good = response.status === 200 && data.status === "ready" && data.service === service.name;
    if (!good) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    console.log(`PASS ${service.name.padEnd(11)} schema=${data.schema} role=${data.role}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${service.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  console.error("\nChua san sang. Xem README muc ket noi PostgreSQL va cau hinh .env.");
  process.exitCode = 1;
} else {
  console.log("\nOK: 3 service ket noi duoc PostgreSQL va nhin thay du bang. Chua test nghiep vu!");
}
