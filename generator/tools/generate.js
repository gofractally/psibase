const { generateTemplateFiles } = require('generate-template-files');

generateTemplateFiles([
    {
        option: "React",
        defaultCase: '(pascalCase)',
        entry: {
            folderPath: './tools/templates/react',
        },
        stringReplacers: [{ question: 'Name of service', slot: '__contract__', defaultCase: "(pascalCase)" }],
        output: {
            path: '../services/user/__contract__/ui',
            pathAndFileNameDefaultCase: '(pascalCase)',
        },
        onComplete: (data) => { console.log(`Success! \nTo get started.. \n \ncd ${data.output.path}`) }
    },
    {
        option: "C++ Service",
        defaultCase: '(pascalCase)',
        entry: {
            folderPath: './tools/templates/cplusplus-service',
        },
        stringReplacers: [{ question: 'Name of service', slot: '__contract__' }],
        output: {
            path: '../services/user/__contract__',
            pathAndFileNameDefaultCase: '(pascalCase)',
        },
        onComplete: (data) => { console.log(`Success! \nTo get started.. \n \ncd ${data.output.path}`) }
    },
    {
        option: "Rust Service",
        defaultCase: '(pascalCase)',
        entry: {
            folderPath: './tools/templates/rust-service',
        },
        stringReplacers: [{ question: 'Name of service', slot: '__contract__' }],
        output: {
            path: '../services/user/__contract__',
            pathAndFileNameDefaultCase: '(pascalCase)',
        },
        onComplete: (data) => { console.log(`Success! \nTo get started.. \n \ncd ${data.output.path}`) }
    }
])