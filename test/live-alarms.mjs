// Read-only: which Sonos alarms exist in the household, and when?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sendSoap } = require('../src/sonos/soap');
const { parseXml, findAll, text } = require('../src/sonos/xml');

const response = await sendSoap({
  host: '192.168.167.50',
  port: 1400,
  service: 'AlarmClock',
  action: 'ListAlarms',
  args: {},
  timeout: 5000,
});
const listXml = text(response, 'CurrentAlarmList', '');
const doc = parseXml(listXml);
const alarms = findAll(doc, 'Alarm');
console.log(`${alarms.length} alarm(er) i husstanden:\n`);
for (const alarm of alarms) {
  const a = alarm.attrs;
  console.log(
    `  ${a.Enabled === '1' ? 'AKTIV ' : 'slået fra'}  ${a.StartTime}  ${String(a.Recurrence).padEnd(12)}  rum=${a.RoomUUID}  ` +
      `vol=${a.Volume}  inkl.grupper=${a.IncludeLinkedZones}  varighed=${a.Duration}  ` +
      `kilde=${String(a.ProgramURI).slice(0, 70)}`,
  );
}
process.exit(0);
