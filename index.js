const fs = require("fs");
const path = require("path");
const minify = require("html-minifier-terser").minify;
const STParser = require("simple-text-parser");

const Parser = STParser.Parser;
const phpTag = "/<\?php([\s\S]+?)\?>/gi";

class PhpHtmlPlugin {

    constructor(options) {
        this.userOptions = options || {};
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
            recursive: true,
            insertion: undefined,
        };

        this.options = Object.assign(defaultOptions, options || {});
        const minifierOptions = this.options.minifierOptions;
        if (minifierOptions.ignoreCustomFragments) {
            minifierOptions.ignoreCustomFragments = [...minifierOptions.ignoreCustomFragments, phpTag];
        } else {
            minifierOptions.ignoreCustomFragments = [phpTag];
        }
    }

    // todo: hot reload
    apply(compiler) {
        compiler.hooks.done.tap("PhpHtmlPlugin", (stats) => {
            const target = path.resolve(stats.compilation.compiler.context, this.options.include);
            const { outputPath } = stats.compilation.compiler;
            if (fs.statSync(target).isDirectory()) {
                this.handleDir(outputPath, target, "");
            } else {
                this.handleFile(outputPath, this.options.include, "");
            }
        })
    }

    handleDir(outputPath, target, targetDir) {
        fs.readdir(target, (err, files) => {
            if (err) {
                throw err;
            }
            files.forEach((name) => {
                if (fs.statSync(path.resolve(target, name)).isDirectory() ) {
                    if (!this.options.recursive) {
                        return
                    }
                    fs.mkdir(path.resolve(outputPath, name));
                    this.handleDir(outputPath, path.resolve(target, name), path.join(targetDir, name));
                } else {
                    this.handleFile(outputPath, path.resolve(target, name), name, targetDir);
                }
                
            });
        });
    }

    handleFile(outputPath, filePath, fileName, targetDir) {
        if (fileName.match(/\.php$/i)) {
            let fileData = fs.readFileSync(filePath).toString();

            const parser = new Parser();
            parser.addRule(/<\?php([\s\S]+?)\?>/gi, function (tag, cleanTag) {
                return { type: "php", text: tag };
            });
            let ast = parser.toTree(fileData);
            if (this.options.minify) {
                this.htmlMinify(ast, fileData);
            }

            ast.unshift({ tag: "php", text: `<?php require_once "${this.options.assetsFileName}" ?>` });
            if (this.options.insertion) {
                if (Array.isArray(this.options.insertion)) {
                    if (this.options.insertion.includes(fileName)) {
                        ast.push({ tag: "php", text: this.insertion() });
                    }
                } else {
                    throw new Error("Option insertion must be array");
                }
            } else {
                ast.push({ tag: "php", text: this.insertion() });
            }

            fileData = Parser.renderTree(ast);
            fs.writeFileSync(path.resolve(outputPath, targetDir, fileName), fileData);
        }
    }

    htmlMinify(ast, fileData) {
        // parse HTML without php tags
        // HTMLMinifier can't work with invalid or partial chunks of markup.
        const minifyAst = parser.toTree(
            minify(fileData, this.options.minifierOptions)
        );
        const phpTags = ast.filter((item) => item.type === "php");
        minifyAst.forEach((item) => {
            if (item.type === "php") {
                item.text = phpTags.shift().text;
            }
        });
        ast = minifyAst;
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