import {getAuthQueueItemStatus} from "../valorant/authQueue.js";
import {wait} from "../misc/util.js";
import config from "../misc/config.js";
import {secondaryEmbed} from "./embed.js";
import {s} from "../misc/languages.js";

export const waitForAuthQueueResponse = async (queueResponse, pollRate=300, maxWaitMs=120000) => {
    if(!queueResponse.inQueue) return queueResponse;
    
    const startTime = Date.now();
    while(true) {
        let response = await getAuthQueueItemStatus(queueResponse.c);
        if(response.processed) return response.result;
        
        // Check timeout
        if (Date.now() - startTime > maxWaitMs) {
            console.error(`Auth queue wait timed out after ${maxWaitMs}ms for c=${queueResponse.c}`);
            return {success: false, error: "Queue wait timeout - please try again later"};
        }
        
        await wait(pollRate);
    }
}

export const activeWaitForAuthQueueResponse = async (interaction, queueResponse, pollRate=config.loginQueuePollRate, maxWaitMs=120000) => {
    // like the above, but edits the interaction to keep the user updated
    let replied = false;
    const startTime = Date.now();
    
    while(true) {
        let response = await getAuthQueueItemStatus(queueResponse.c);
        if(response.processed) return response.result;

        // Check timeout
        if (Date.now() - startTime > maxWaitMs) {
            console.error(`Auth queue wait timed out after ${maxWaitMs}ms for c=${queueResponse.c}`);
            return {success: false, error: "Queue wait timeout - please try again later"};
        }

        let embed;
        if(response.timestamp) embed = secondaryEmbed(s(interaction).error.QUEUE_WAIT.f({t: response.timestamp }));
        else embed = secondaryEmbed("Processing...");
        if(replied) await interaction.editReply({embeds: [embed]});
        else {
            await interaction.followUp({embeds: [embed]});
            replied = true;
        }

        await wait(pollRate);
    }
}
