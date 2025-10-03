const richTextHasContent = (richText) => {
    try {
        let content = richText?.content || [];
        for (let item of content) {
            if (Array.isArray(item.content) && item.content?.length > 0) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error("Invalid JSON input:", error);
        return false;
    }
};

export default richTextHasContent