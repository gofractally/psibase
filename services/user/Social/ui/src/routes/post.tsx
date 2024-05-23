import { Params, useLoaderData } from "react-router-dom";

import { MailDisplay } from "@components";

import { mails, type Mail } from "../fixtures/data";

export function postLoader({ params }: { params: Params<string> }) {
    return { post: mails.find((item) => item.id === params.postId) };
}

export function Post() {
    const { post } = useLoaderData() as { post: Mail };

    return <MailDisplay mail={post} />;
}

export default Post;
