module.exports = ({ config }) => {
    // Add SVGR Loader
    // Remove svg rules from existing webpack rule
    let assetRule = config.module.rules.find(({ test }) => test && test.test('.svg'));
    assetRule.test = /\.(ico|jpg|jpeg|png|apng|gif|eot|otf|webp|ttf|woff|woff2|cur|ani|pdf)(\?.*)?$/;
    config.module.rules.unshift({
        test: /\.svg$/,
        use: ['@svgr/webpack'],
    });
    return config;
};
