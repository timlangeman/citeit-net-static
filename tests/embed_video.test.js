describe('Twitter/X embed tests', () => {
    test('should parse Twitter URL correctly', () => {
        const twitterUrl = 'https://twitter.com/username/status/1234567890';
        const xUrl = 'https://x.com/username/status/1234567890';
        
        expect(parseVideoUrl(twitterUrl)).toEqual({
            provider: 'twitter',
            id: '1234567890',
            username: 'username'
        });
        
        expect(parseVideoUrl(xUrl)).toEqual({
            provider: 'twitter',
            id: '1234567890',
            username: 'username'
        });
    });

    test('should create correct Twitter embed URL', () => {
        const tweetInfo = {
            provider: 'twitter',
            id: '1234567890',
            username: 'username'
        };
        
        const embedUrl = createTwitterEmbed(tweetInfo);
        expect(embedUrl).toContain('platform.twitter.com/embed/Tweet.html');
        expect(embedUrl).toContain('id=1234567890');
    });
});