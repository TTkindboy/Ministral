import { fetchChannel, isToday } from "../misc/util.js";
import { VPEmoji, KCEmoji } from "../discord/emoji.js";
import { renderBundles, renderNightMarket, renderOffers, renderAccessoryOffers } from "../discord/embed.js";
import { getUser } from "./auth.js";
import { getBundles, getNightMarket, getOffers, NMTimestamp } from "./shop.js";

export const fetchShop = async (interaction, user, targetId = interaction.user.id, accessory = null) => {
    // fetch the channel if not in cache
    const channel = interaction.channel || await fetchChannel(interaction.channelId);

    // start uploading emoji now
    const emojiPromise = VPEmoji(interaction, channel);
    const KCEmojiPromise = KCEmoji(interaction, channel)

    let shop = await getOffers(targetId);
    user = getUser(user);
    if (accessory === "daily" || !accessory) {
        return await renderOffers(shop, interaction, user, await emojiPromise, targetId)
    } else {
        return await renderAccessoryOffers(shop, interaction, user, await KCEmojiPromise, targetId)
    }

}

export const isThereANM = () => {
    if (!NMTimestamp) return false;
    if (isToday(NMTimestamp)) return true;
    else {
        //NMTimestamp = null; not working, waiting for fix.
        return false;
    }
}

export const fetchBundles = async (interaction) => {
    const channel = interaction.channel || await fetchChannel(interaction.channelId);
    const emojiPromise = VPEmoji(interaction, channel);

    let bundles = await getBundles(interaction.user.id);
    return await renderBundles(bundles, interaction, await emojiPromise);
}

export const fetchNightMarket = async (interaction, user) => {
    const channel = interaction.channel || await fetchChannel(interaction.channelId);
    const emojiPromise = VPEmoji(interaction, channel);

    let market = await getNightMarket(interaction.user.id);
    return await renderNightMarket(market, interaction, user, await emojiPromise);
}
