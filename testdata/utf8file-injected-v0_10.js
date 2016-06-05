/*global describe, it, beforeEach, afterEach*/
var http = require('http');
var expect = require('unexpected');

describe('example with http recorded and injected file', function () {
    expect = expect.clone()
        .use(require('../lib/unexpectedMitm'))
        .use(require('unexpected-http'));

    var handleRequest,
        server,
        serverAddress,
        serverHostname,
        serverUrl;
    beforeEach(function () {
        handleRequest = undefined;
        server = http.createServer(function (req, res) {
            res.sendDate = false;
            handleRequest(req, res);
        }).listen(59891);
        serverAddress = server.address();
        serverHostname = serverAddress.address === '::' ? 'localhost' : serverAddress.address;
        serverUrl = 'http://' + serverHostname + ':' + serverAddress.port + '/';
    });

    afterEach(function () {
        server.close();
    });

    it('should record', function () {
        handleRequest = function (req, res) {
            res.setHeader('Content-Type', 'text/plain');
            res.end('quux & xuuq');
        };
        return expect({
            url: 'GET ' + serverUrl
        }, 'with http mocked out', {
            request: {
                url: 'GET /', headers: { Host: '0.0.0.0:59891' }, host: '0.0.0.0',
                port: 59891
            },
            response: { headers: { 'Content-Type': 'text/plain' }, body: 'quux & xuuq' }
        }, 'to yield response', 200);
    });
});
