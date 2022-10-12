const { generateTemplateFiles } = require('generate-template-files');

generateTemplateFiles([
    {
        option: "React",
        defaultCase: '(pascalCase)',
        entry: {
            folderPath: './tools/templates/react',
        },
        stringReplacers: [{ question: 'Name of contract', slot: '__contract__', defaultCase: "(pascalCase)" }],
        output: {
            path: '../services/user/__contract__/ui',
            pathAndFileNameDefaultCase: '(pascalCase)',
        },
        onComplete: (data) => { console.log(`Success! \nTo get started.. \n \ncd ${data.output.path}`) }
    },
    {
        option: "Contract",
        defaultCase: '(pascalCase)',
        entry: {
            folderPath: './tools/templates/contract',
        },
        stringReplacers: [{ question: 'Name of contract', slot: '__contract__' }],
        output: {
            path: '../services/user/__contract__',
            pathAndFileNameDefaultCase: '(pascalCase)',
        },
        onComplete: (data) => { console.log(`Success! \nTo get started.. \n \ncd ${data.output.path}`) }
    }
])