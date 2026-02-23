import { isMainThread } from 'worker_threads';
import { loadConfig } from "./misc/config.js";

if (isMainThread) {
    import('./shardingLogic.js').then(module => module.startShardingManager());
} else {
    import('./botLogic.js').then(module => module.startBotWorker());
}
