import {redeemCookies} from "./auth.js";
import config from "../misc/config.js";
import {wait} from "../misc/util.js";
import {
    getNextCounter,
    pushAuthQueue,
    popAuthQueue,
    getAuthResult,
    storeAuthResult,
    getAuthQueueLength,
    isRedisAvailable,
    markAuthProcessing,
    unmarkAuthProcessing,
    cleanupStaleProcessing,
    acquireProcessingLock,
    releaseProcessingLock
} from "../misc/redisQueue.js";
import {client} from "../discord/bot.js";

export const Operations = {
    COOKIES: "ck",
    NULL: "00"
}

// Local queue for when Redis is not available (fallback)
const localQueue = [];
const localQueueResults = [];
let localQueueCounter = 1;
let processingCount = 0;

let authQueueInterval;
let lastQueueProcess = 0; // timestamp

export const startAuthQueue = () => {
    clearInterval(authQueueInterval);
    if(config.useLoginQueue) {
        authQueueInterval = setInterval(processAuthQueue, config.loginQueueInterval);
        
        // Cleanup stale processing marks every 5 minutes if using Redis
        if (isRedisAvailable()) {
            setInterval(cleanupStaleProcessing, 5 * 60 * 1000);
        }
    }
}

export const queueCookiesLogin = async (id, cookies) => {
    if(!config.useLoginQueue) return await redeemCookies(id, cookies);

    // Use Redis if available, otherwise fallback to local queue
    if (isRedisAvailable()) {
        const c = await getNextCounter();
        await pushAuthQueue({
            operation: Operations.COOKIES,
            c, id, cookies
        });
        console.log(`[Redis] Added cookie login to auth queue for user ${id} (c=${c})`);
        return {inQueue: true, c};
    } else {
        // Fallback to local queue
        const c = localQueueCounter++;
        localQueue.push({
            operation: Operations.COOKIES,
            c, id, cookies
        });
        console.log(`[Local] Added cookie login to auth queue for user ${id} (c=${c})`);

        if(processingCount === 0) await processAuthQueue();
        return {inQueue: true, c};
    }
};

export const queueNullOperation = async (timeout) => {  // used for stress-testing the auth queue
    if(!config.useLoginQueue) {
        await wait(timeout);
        return {success: true};
    }

    // Use Redis if available, otherwise fallback to local queue
    if (isRedisAvailable()) {
        const c = await getNextCounter();
        await pushAuthQueue({
            operation: Operations.NULL,
            c, timeout
        });
        console.log(`[Redis] Added null operation to auth queue with timeout ${timeout} (c=${c})`);
        return {inQueue: true, c};
    } else {
        // Fallback to local queue
        const c = localQueueCounter++;
        localQueue.push({
            operation: Operations.NULL,
            c, timeout
        });
        console.log(`[Local] Added null operation to auth queue with timeout ${timeout} (c=${c})`);

        if(processingCount === 0) await processAuthQueue();
        return {inQueue: true, c};
    }
};

export const processAuthQueue = async () => {
    lastQueueProcess = Date.now();
    if(!config.useLoginQueue) return;

    // Use Redis if available
    if (isRedisAvailable()) {
        const shardId = client.shard ? client.shard.ids[0] : 0;
        
        // Try to acquire the processing lock
        // Only one shard across the cluster can hold this lock at a time
        const lockAcquired = await acquireProcessingLock(shardId);
        if (!lockAcquired) {
            // Another shard is processing, skip this tick
            return;
        }

        try {
            const item = await popAuthQueue();
            if (!item) {
                // Queue is empty, release lock and return
                await releaseProcessingLock();
                return;
            }

            console.log(`[Shard ${shardId}] Processing Redis auth queue item "${item.operation}" for ${item.id} (c=${item.c})`);

            await markAuthProcessing(item.c, shardId);
            processingCount++;

            let result;
            try {
                switch (item.operation) {
                    case Operations.COOKIES:
                        result = await redeemCookies(item.id, item.cookies);
                        break;
                    case Operations.NULL:
                        await wait(item.timeout);
                        result = {success: true};
                        break;
                }
            } catch(e) {
                result = {success: false, error: e.message};
            }

            // Store result in Redis
            await storeAuthResult(item.c, result);
            await unmarkAuthProcessing(item.c);

            console.log(`[Shard ${shardId}] Finished processing Redis auth queue item "${item.operation}" for ${item.id} (c=${item.c})`);
            processingCount--;
        } finally {
            // Always release the lock, even if processing failed
            await releaseProcessingLock();
        }
    } else {
        // Fallback to local queue
        if(!localQueue.length) return;

        const item = localQueue.shift();
        console.log(`[Local] Processing auth queue item "${item.operation}" for ${item.id} (c=${item.c}, left=${localQueue.length})`);
        processingCount++;

        let result;
        try {
            switch (item.operation) {
                case Operations.COOKIES:
                    result = await redeemCookies(item.id, item.cookies);
                    break;
                case Operations.NULL:
                    await wait(item.timeout);
                    result = {success: true};
                    break;
            }
        } catch(e) {
            result = {success: false, error: e};
        }

        localQueueResults.push({
            c: item.c,
            result
        });

        console.log(`[Local] Finished processing auth queue item "${item.operation}" for ${item.id} (c=${item.c})`);
        processingCount--;
    }
};

export const getAuthQueueItemStatus = async (c) => {
    // Use Redis if available
    if (isRedisAvailable()) {
        // Check if result is ready
        const result = await getAuthResult(c);
        if (result) {
            return {processed: true, result};
        }

        // Check if in queue or processing
        const queueLength = await getAuthQueueLength();
        return {
            processed: false, 
            remaining: queueLength,
            timestamp: Math.round((Date.now() + ((queueLength + 1) * config.loginQueueInterval) + 2000) / 1000)
        };
    } else {
        // Fallback to local queue
        // check if in queue
        let item = localQueue.find(i => i.c === c);
        if(item) return {processed: false, ...remainingAndEstimatedTimestamp(c)};

        // check if currently processing
        const index = localQueueResults.findIndex(i => i.c === c);
        if(index === -1) return {processed: false, remaining: 0};

        // get result
        item = localQueueResults[index];
        localQueueResults.splice(index, 1);
        return {processed: true, result: item.result};
    }
};

const remainingAndEstimatedTimestamp = (c) => {
    const remaining = c - localQueue[0].c;
    let timestamp = lastQueueProcess + ((remaining + 1) * config.loginQueueInterval);

    // UX: if the timestamp is late, even by half a second, the user gets impatient.
    // on the other hand, if it happens early, the user is happy.
    timestamp += 2000;
    timestamp = Math.round(timestamp / 1000);

    return {remaining, timestamp};
};
