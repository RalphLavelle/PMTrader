/** Phase 1 research-dataset collector — public entry points. */
export { startCollector, stopCollector } from './runner.js';
export { loadSchedule, scheduleFilePath } from './schedule.js';
export type { CollectorScheduleFile, CollectorStreamName, StreamSchedule } from './types.js';
