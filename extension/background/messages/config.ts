import type { PlasmoMessaging } from "@plasmohq/messaging"
import { upload_cookie, download_cookie, bidirectional_sync } from '../../function';

export type RequestBody = {
    payload: object
}

export type ResponseBody = {
    message: string,
    note: string|null,
}

export const handler: PlasmoMessaging.MessageHandler<RequestBody,
ResponseBody> = async (req, res) => {
    const payload = req.body.payload;
    let result;

    if (payload['type'] && payload['type'] == 'down') {
        result = await download_cookie(payload);
    } else if (payload['type'] && payload['type'] == 'sync') {
        result = await bidirectional_sync(payload);
    } else {
        result = await upload_cookie(payload);
    }

    res.send({
        message: result?.action || (result?.success ? 'done' : 'error'),
        note: result?.note || null,
    })
}

