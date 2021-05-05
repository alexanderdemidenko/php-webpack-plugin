const fs = require("fs");
const path = require("path");
const minify = require('html-minifier-terser').minify;
const STParser = require("simple-text-parser");

const Parser = STParser.Parser;
const phpTag = "/<\?php([\s\S]+?)\?>/gi";

class PhpHtmlPlugin {

    constructor(options) {
        this.userOptions = options || {};
    }

    // todo: зависимости для хот релоад
    apply(compiler) {
        compiler.hooks.done.tap("PhpHtmlPlugin", (stats) => {

            const defaultOptions = {
                include: "./php",
                exclude: [],
                minify: process.env.NODE_ENV === "production",
                assetsFileName: "assetsMap.php",
                minifierOptions: {
                    continueOnParseError: true,
                    collapseWhitespace: true,
                    removeComments: true,
                },
                deepHandle: true,
                insertion: true,
            };

            this.options = Object.assign(defaultOptions, this.userOptions);
            const minifierOptions = this.options.minifierOptions;
            if (minifierOptions.ignoreCustomFragments) {
                minifierOptions.ignoreCustomFragments = [...minifierOptions.ignoreCustomFragments, phpTag];
            } else {
                minifierOptions.ignoreCustomFragments = [phpTag];
            }


            const target = path.resolve(stats.compilation.compiler.context, this.options.include);

            if (fs.statSync(target).isDirectory()) {
                this.handleDir(stats, target);
            } else {
                this.handleFile(stats, target);
            }
        })
    }

    handleDir(stats, target) {
        fs.readdir(target, function(err, files) {
            files.forEach(function(fileName) {
                //todo: deep exclude
                if (this.options.exclude.includes(fileName)) { 
                    return
                }
                if (fs.statSync(`${target}/${fileName}`).isDirectory() ) {
                    if (!this.options.deepHandle) {
                        return
                    }
                    // todo: create dir
                    this.handleDir(stats, `${target}/${fileName}`);
                } else {
                    this.handleFile(stats, fileName);
                }
                
            })
        })
    }

    handleFile(stats, fileName) {
        if (fileName.match(/\.php$/i)) {
            let fileData = fs.readFileSync(fileName).toString();

            const parser = new Parser();
            parser.addRule(/<\?php([\s\S]+?)\?>/gi, function (tag, clean_tag) {
                return { type: "php", text: tag };
            });
            let ast = parser.toTree(fileData);
            if (this.options.minify) {
                //парсинг файла для возврата пхп тэгов
                //HTMLMinifier can't work with invalid or partial chunks of markup.
                const minifyAst = parser.toTree(minify(fileData, this.options.minifierOptions));
                const phpTags = ast.filter(item => item.type === "php");
                minifyAst.forEach(item => {
                    if (item.type === "php") {
                        item.text = phpTags.shift().text;
                    }
                });
                ast = minifyAst;
            }

            ast.unshift({ tag: "php", text: `<?php require_once "${this.options.assetsFileName}" ?>` });
            if (this.options.insertion) {
                if (Array.isArray(this.options.insertion)) {
                    // todo: deep
                    if (this.options.insertion.includes(fileName)) {
                        ast.unshift({ tag: "php", text: this.insertion() });
                    }
                } else {

                }
            }

            fileData = Parser.renderTree(ast);
            //todo: path
            fs.writeFileSync(`${stats.compilation.compiler.outputPath}/index.php`, fileData);
        }
    }

    insertion() {
        return `<?php
            function insertion($variant, $entry){
                global $assetsMap;
                $js = $assetsMap['js'];
                if (isset($js[$entry])) {
                    foreach ($js[$entry] as $v) {
                        echo '<script type="text/javascript">';
                            require_once($v);
                        echo'</script>';
                    }
                }
            }
        ?>`;
    }
}

module.exports = PhpHtmlPlugin;