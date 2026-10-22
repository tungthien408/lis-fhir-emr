// Chay lenh `npm run dev` truoc, sau do moi chay `npm run smoke`.
const services = [
  { name: "lis", port: process.env.LIS_PORT ?? "3101" },
  { name: "middleware", port: process.env.MIDDLEWARE_PORT ?? "3102" },
  { name: "emr", port: process.env.EMR_PORT ?? "3103" },
];

let failures = 0;

for (const service of services) {
  const url = `http://127.0.0.1:${service.port}/health`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    const ok = response.status === 200 && data.service === service.name && data.status === "ok";

    if (!ok) {
      throw new Error(`Phan hoi khong dung: HTTP ${response.status} ${JSON.stringify(data)}`);
    }

    console.log(`PASS  ${service.name.padEnd(11)} ${url}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${service.name.padEnd(11)} ${url}`);
    console.error(`      ${error.message}`);
  }
}

if (failures > 0) {
  console.error("\nKiem tra that bai. Hay chay `npm run dev` o terminal khac truoc.");
  process.exitCode = 1;
} else {
  console.log("\nOK: Ca 3 service deu phan hoi /health. (Chua kiem tra database/nghiep vu.)");
}
