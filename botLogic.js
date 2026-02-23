import {loadConfig} from "./misc/config.js";
import {startBot} from "./discord/bot.js";
import {loadLogger} from "./misc/logger.js";
import {initRedis} from "./misc/redisQueue.js"
import {initUserDatabase} from "./misc/userDatabase.js";

export const startBotWorker = () => {
    const config = loadConfig();
    if(config) {
        loadLogger();

        if (!initUserDatabase()) {
            console.error("User database initialization failed. Cannot start bot.");
            process.exit(1);
        }
        
        initRedis().then(() => {
            startBot();
        }).catch(err => {
            console.error("Failed to initialize Redis, cannot start bot without it:", err);
            process.exit(1);
        });
    }
}
