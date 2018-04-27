/*global Promise:false*/
module.exports = function consumeReadableStream(readableStream, options) {
    options = options || {};
    var skipConcat = !!options.skipConcat;

    return new Promise(function (resolve, reject) {
        var chunks = [];
        readableStream.on('data', function (chunk) {
            chunks.push(chunk);
        }).on('end', function (chunk) {
            resolve({ body: skipConcat ? chunks : Buffer.concat(chunks) });
        }).on('error', function (err) {
            resolve({ body: skipConcat ? chunks : Buffer.concat(chunks), error: err });
        });
    });
};