/*global describe, it, __dirname, beforeEach, afterEach, setTimeout, setImmediate*/
var pathModule = require('path');
var childProcess = require('child_process');
var fs = require('fs');
var http = require('http');
var https = require('https');
var messy = require('messy');
var pem = require('pem');
var stream = require('stream');
var semver = require('semver');
var sinon = require('sinon');
var socketErrors = require('socketerrors-papandreou');

function issueGetAndConsume(url, callback) {
  http
    .get(url)
    .on('response', response => {
      var chunks = [];

      response
        .on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : new Buffer(chunk));
        })
        .on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
    })
    .on('error', callback)
    .end();
}

function trimDiff(message) {
  message = message.replace(/^[\\ ]*Date:.*\n/gm, '');
  message = message.replace(/^[\\ ]*Connection:.*\n/gm, '');
  message = message.replace(/^[\\ ]*Transfer-Encoding:.*\n?/gm, '');
  message = message.replace(/^[\\ ]*Content-Length: 0\n?/gm, '');
  message = message.replace(/HTTP\/1.1 200 OK\n$/, 'HTTP/1.1 200 OK');

  return message;
}

describe('unexpectedMitm', () => {
  var expect = require('unexpected')
    .use(require('../lib/unexpectedMitm'))
    .use(require('unexpected-http'))
    .use(require('unexpected-sinon'))
    .use(require('unexpected-messy'))
    .addAssertion(
      '<any> with expected http recording <object> <assertion>',
      (expect, subject, expectedRecordedExchanges) => {
        // ...
        expect.errorMode = 'nested';
        expect.args.splice(1, 0, 'with http recorded with extra info');
        return expect
          .promise(() => {
            return expect.shift();
          })
          .spread((value, recordedExchanges) => {
            expect(recordedExchanges, 'to equal', expectedRecordedExchanges);
            return value;
          });
      }
    )
    .addAssertion(
      '<any> was written correctly on <object> <assertion>',
      (expect, subject, requestObject) => {
        expect.errorMode = 'bubble';
        var expectedRecordedExchanges = subject;
        var testFile;
        var writtenExchanges;

        return expect
          .promise(() => {
            return expect.shift(requestObject);
          })
          .spread((recordedExchanges, _, __, recordedFile) => {
            testFile = recordedFile;

            return expect(() => {
              writtenExchanges = require(testFile);
            }, 'not to throw').then(() => {
              return expect(
                recordedExchanges,
                'to equal',
                expectedRecordedExchanges
              ).then(() => {
                return expect(
                  writtenExchanges,
                  'to equal',
                  expectedRecordedExchanges
                );
              });
            });
          })
          .finally(() => {
            if (testFile) {
              fs.truncateSync(testFile);
            }
          });
      }
    )
    .addAssertion(
      '<any> was read correctly on <object> <assertion>',
      (expect, subject, drivingRequest) => {
        expect.errorMode = 'bubble';
        var expectedRecordedExchanges = subject;

        return expect
          .promise(() => {
            return expect.shift(drivingRequest);
          })
          .spread(recordedExchanges => {
            return expect(
              recordedExchanges.httpExchange,
              'to satisfy',
              expectedRecordedExchanges
            );
          });
      }
    )
    .addAssertion(
      '<string> when injected becomes <string>',
      (expect, subject, expectedFileName) => {
        expect.errorMode = 'nested';
        var basePath = pathModule.join(__dirname, '..');
        var testPath = pathModule.join(basePath, 'testdata');

        var commandPath = pathModule.join(
          basePath,
          'node_modules',
          '.bin',
          'mocha'
        );
        var inputFilePath = pathModule.join(testPath, subject + '.js');
        var expectedFilePath = pathModule.join(
          testPath,
          expectedFileName + '.js'
        );
        var outputFilePath = pathModule.join(testPath, '.' + subject + '.js');

        return expect
          .promise(run => {
            // create a temporary output file
            fs.writeFileSync(outputFilePath, fs.readFileSync(inputFilePath));

            // execute the mocha test file which will cause injection
            childProcess.execFile(
              commandPath,
              [outputFilePath],
              {
                cwd: basePath
              },
              run(err => {
                expect(err, 'to be falsy');
                var inputFileData = fs.readFileSync(outputFilePath).toString();
                var outputFileData = fs
                  .readFileSync(expectedFilePath)
                  .toString();

                expect(inputFileData, 'to equal', outputFileData);
              })
            );
          })
          .finally(() => {
            try {
              // swallow any unlink error
              fs.unlinkSync(outputFilePath);
            } catch (e) {}
          });
      }
    )
    .addAssertion(
      '<messyHttpExchange> to have a response with body <any>',
      (expect, subject, value) => {
        return expect.promise(() => {
          var response = subject.response;

          if (!response.body) {
            throw new Error('Missing response body.');
          }

          return expect(response.body, 'to equal', value);
        });
      }
    )
    .addAssertion(
      '<any> when delayed a little bit <assertion>',
      (expect, subject) => {
        return expect.promise(run => {
          setTimeout(
            run(() => {
              return expect.shift();
            }),
            1
          );
        });
      }
    );

  expect.output.preferredWidth = 150;

  function createPemCertificate(certOptions) {
    return expect.promise.fromNode(cb => {
      pem.createCertificate(cb);
    });
  }

  it('should mock out a simple request', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8'
          },
          body: '<!DOCTYPE html>\n<html></html>'
        }
      },
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=UTF-8'
        },
        body: '<!DOCTYPE html>\n<html></html>'
      }
    );
  });

  it('should mock out a request with a binary body', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          body: new Buffer([0x00, 0x01, 0xef, 0xff])
        }
      },
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: new Buffer([0x00, 0x01, 0xef, 0xff])
      }
    );
  });

  it('should clean up properly after a keep-alived request with a custom Agent instance', () => {
    var agent = new http.Agent({ keepAlive: true });
    return expect(
      () => {
        return expect.promise(run => {
          http.get({ host: 'example.com', agent: agent }).on(
            'response',
            run(response => {
              response.on('data', () => {}).on('end', run());
            })
          );
        });
      },
      'with http mocked out',
      [{ request: 'GET http://example.com/', response: 200 }],
      'not to error'
    ).then(() => {
      return expect(
        () => {
          return expect.promise(run => {
            http.get({ host: 'example.com', agent: agent }).on(
              'response',
              run(response => {
                response.on('data', () => {}).on('end', run(() => {}));
              })
            );
          });
        },
        'with http mocked out',
        [{ request: 'GET http://example.com/', response: 200 }],
        'not to error'
      );
    });
  });

  it('should clean up properly after a keep-alived request with the global agent', () => {
    var originalKeepAliveValue = http.globalAgent.keepAlive;
    http.globalAgent.keepAlive = true;
    return expect(
      () => {
        return expect.promise(run => {
          http.get({ host: 'example.com' }).on(
            'response',
            run(response => {
              response.on('data', () => {}).on('end', run());
            })
          );
        });
      },
      'with http mocked out',
      [{ request: 'GET http://example.com/', response: 200 }],
      'not to error'
    )
      .then(() => {
        return expect(
          () => {
            return expect.promise(run => {
              http.get({ host: 'example.com' }).on(
                'response',
                run(response => {
                  response.on('data', () => {}).on('end', run(() => {}));
                })
              );
            });
          },
          'with http mocked out',
          [{ request: 'GET http://example.com/', response: 200 }],
          'not to error'
        );
      })
      .finally(() => {
        http.globalAgent.keepAlive = originalKeepAliveValue;
      });
  });

  it('should mock out an erroring response', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: new Error('foo')
      },
      'to yield response',
      new Error('foo')
    );
  });

  it('should mock out an erroring response 2', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: new socketErrors.ECONNRESET()
      },
      'to yield response',
      new socketErrors.ECONNRESET()
    );
  });

  it('should mock out an application/json response', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: {
          body: { abc: 123 }
        }
      },
      'to yield response',
      {
        headers: {
          'Content-Type': 'application/json'
        },
        body: { abc: 123 }
      }
    );
  });

  it('should mock out an application/json response with invalid JSON', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: {
          headers: {
            'Content-Type': 'application/json'
          },
          body: '!==!='
        }
      },
      'to yield response',
      {
        headers: {
          'Content-Type': 'application/json'
        },
        unchunkedBody: new Buffer('!==!=', 'utf-8')
      }
    );
  });

  it('should preserve the original serialization of JSON provided as a string', () => {
    return expect(
      cb => {
        http
          .get('http://www.examplestuff.com/')
          .on('error', cb)
          .on('response', response => {
            var chunks = [];
            response
              .on('data', chunk => {
                chunks.push(chunk);
              })
              .on('end', () => {
                expect(
                  Buffer.concat(chunks).toString('utf-8'),
                  'to equal',
                  '{"foo":\n123\n}'
                );
                cb();
              });
          })
          .end();
      },
      'with http mocked out',
      [
        {
          response: {
            headers: {
              'Content-Type': 'application/json'
            },
            body: '{"foo":\n123\n}'
          }
        }
      ],
      'to call the callback without error'
    );
  });

  describe('with async expects on the request', () => {
    it('should succeed', () => {
      return expect(
        {
          url: 'POST http://www.google.com/',
          body: { foo: 123 }
        },
        'with http mocked out',
        {
          request: {
            url: 'POST /',
            body: expect.it('when delayed a little bit', 'to equal', {
              foo: 123
            })
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/html; charset=UTF-8'
            },
            body: '<!DOCTYPE html>\n<html></html>'
          }
        },
        'to yield response',
        {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8'
          },
          body: '<!DOCTYPE html>\n<html></html>'
        }
      );
    });

    it('should fail with a diff', () => {
      return expect(
        expect(
          {
            url: 'POST http://www.google.com/',
            body: { foo: 123 }
          },
          'with http mocked out',
          {
            request: {
              url: 'POST /',
              body: expect.it('when delayed a little bit', 'to equal', {
                foo: 456
              })
            },
            response: {
              statusCode: 200,
              headers: {
                'Content-Type': 'text/html; charset=UTF-8'
              },
              body: '<!DOCTYPE html>\n<html></html>'
            }
          },
          'to yield response',
          {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/html; charset=UTF-8'
            },
            body: '<!DOCTYPE html>\n<html></html>'
          }
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            trimDiff(message),
            'to equal',
            "expected { url: 'POST http://www.google.com/', body: { foo: 123 } } with http mocked out\n" +
              '{\n' +
              "  request: { url: 'POST /', body: expect.it('when delayed a little bit', 'to equal', ...) },\n" +
              "  response: { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: '<!DOCTYPE html>\\n<html></html>' }\n" +
              "} to yield response { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: '<!DOCTYPE html>\\n<html></html>' }\n" +
              '\n' +
              'POST / HTTP/1.1\n' +
              'Host: www.google.com\n' +
              'Content-Type: application/json\n' +
              '\n' +
              'expected { foo: 123 } when delayed a little bit to equal { foo: 456 }\n' +
              '\n' +
              '{\n' +
              '  foo: 123 // should equal 456\n' +
              '}\n' +
              '\n' +
              'HTTP/1.1 200 OK\n' +
              'Content-Type: text/html; charset=UTF-8\n' +
              '\n' +
              '<!DOCTYPE html>\n' +
              '<html></html>'
          );
        }
      );
    });
  });

  it('should not break when the assertion being delegated to throws synchronously', () => {
    return expect(
      expect(
        'http://www.google.com/',
        'with http mocked out',
        [],
        'to foobarquux'
      ),
      'to be rejected with',
      /^Unknown assertion 'to foobarquux'/
    );
  });

  describe('when mocking out an https request and asserting that the request is https', () => {
    describe('when https is specified as part of the request url', () => {
      it('should succeed', () => {
        return expect(
          'https://www.google.com/',
          'with http mocked out',
          {
            request: 'GET https://www.google.com/',
            response: 200
          },
          'to yield response',
          200
        );
      });

      it('should fail', () => {
        return expect(
          expect(
            'http://www.google.com/',
            'with http mocked out',
            {
              request: 'GET https://www.google.com/',
              response: 200
            },
            'to yield response',
            200
          ),
          'when rejected',
          'to have message',
          message => {
            expect(
              trimDiff(message),
              'to equal',
              "expected 'http://www.google.com/' with http mocked out { request: 'GET https://www.google.com/', response: 200 } to yield response 200\n" +
                '\n' +
                'GET / HTTP/1.1\n' +
                'Host: www.google.com\n' +
                '// expected an encrypted request\n' +
                '\n' +
                'HTTP/1.1 200 OK'
            );
          }
        );
      });
    });

    describe('when "encrypted" is specified as a standalone property', () => {
      it('should succeed', () => {
        return expect(
          'https://www.google.com/',
          'with http mocked out',
          {
            request: { url: 'GET /', encrypted: true },
            response: 200
          },
          'to yield response',
          200
        );
      });

      it('should fail', () => {
        return expect(
          expect(
            'http://www.google.com/',
            'with http mocked out',
            {
              request: { url: 'GET /', encrypted: true },
              response: 200
            },
            'to yield response',
            200
          ),
          'when rejected',
          'to have message',
          message => {
            expect(
              trimDiff(message),
              'to equal',
              "expected 'http://www.google.com/' with http mocked out { request: { url: 'GET /', encrypted: true }, response: 200 } to yield response 200\n" +
                '\n' +
                'GET / HTTP/1.1\n' +
                'Host: www.google.com\n' +
                '// expected an encrypted request\n' +
                '\n' +
                'HTTP/1.1 200 OK'
            );
          }
        );
      });
    });
  });

  describe('using a fully-qualified request url', () => {
    it('should assert on the host name of the issued request', () => {
      return expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: 'GET http://www.google.com/',
          response: 200
        },
        'to yield response',
        200
      );
    });

    it('should fail', () => {
      return expect(
        expect(
          'http://www.google.com/',
          'with http mocked out',
          {
            request: 'POST http://www.example.com/',
            response: 200
          },
          'to yield response',
          200
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            trimDiff(message),
            'to equal',
            "expected 'http://www.google.com/' with http mocked out { request: 'POST http://www.example.com/', response: 200 } to yield response 200\n" +
              '\n' +
              'GET / HTTP/1.1 // should be POST /\n' +
              '               //\n' +
              '               // -GET / HTTP/1.1\n' +
              '               // +POST / HTTP/1.1\n' +
              'Host: www.google.com // should equal www.example.com\n' +
              '                     //\n' +
              '                     // -www.google.com\n' +
              '                     // +www.example.com\n' +
              "// host: expected 'www.google.com' to equal 'www.example.com'\n" +
              '//\n' +
              '// -www.google.com\n' +
              '// +www.example.com\n' +
              '\n' +
              'HTTP/1.1 200 OK'
          );
        }
      );
    });
  });

  it('should support mocking out the status code', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: 412
      },
      'to yield response',
      {
        statusCode: 412
      }
    );
  });

  it('should work fine without any assertions on the request', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        response: 412
      },
      'to yield response',
      412
    );
  });

  describe('with multiple mocks specified', () => {
    it("should succeed with 'to call the callback without error'", () => {
      return expect(
        cb => {
          issueGetAndConsume('http://www.google.com/', () => {
            issueGetAndConsume('http://www.google.com/', cb);
          });
        },
        'with http mocked out',
        [
          {
            request: 'GET http://www.google.com/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: 'hello'
            }
          },
          {
            request: 'GET http://www.google.com/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: 'world'
            }
          }
        ],
        'to call the callback without error'
      );
    });

    it("should succeed with 'not to error'", () => {
      return expect(
        () => {
          return expect.promise(run => {
            issueGetAndConsume(
              'http://www.google.com/',
              run(() => {
                issueGetAndConsume('http://www.google.com/', run(() => {}));
              })
            );
          });
        },
        'with http mocked out',
        [
          {
            request: 'GET http://www.google.com/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: 'hello'
            }
          },
          {
            request: 'GET http://www.google.com/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: 'world'
            }
          }
        ],
        'not to error'
      );
    });
  });

  describe('with a response body provided as a stream', () => {
    it('should support providing such a response', () => {
      return expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: 'GET /',
          response: {
            body: fs.createReadStream(
              pathModule.resolve(__dirname, '..', 'testdata', 'foo.txt')
            )
          }
        },
        'to yield response',
        {
          statusCode: 200,
          body: new Buffer('Contents of foo.txt\n', 'utf-8')
        }
      );
    });

    it('should decode the stream as a string', () => {
      return expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: 'GET /',
          response: {
            headers: {
              'Content-Type': 'text/plain; charset=UTF-8'
            },
            body: fs.createReadStream(
              pathModule.resolve(__dirname, '..', 'testdata', 'foo.txt')
            )
          }
        },
        'to yield response',
        {
          statusCode: 200,
          body: 'Contents of foo.txt\n'
        }
      );
    });

    it('should decode the stream as JSON', () => {
      var responseBodyStream = new stream.Readable();
      responseBodyStream._read = (num, cb) => {
        responseBodyStream._read = () => {};
        setImmediate(() => {
          responseBodyStream.push(JSON.stringify({ foo: 'bar' }));
          responseBodyStream.push(null);
        });
      };

      return expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: 'GET /',
          response: {
            headers: {
              'Content-Type': 'application/json'
            },
            body: responseBodyStream
          }
        },
        'to yield response',
        {
          statusCode: 200,
          body: {
            foo: 'bar'
          }
        }
      );
    });

    it('should treat Content-Length case insentitively', () => {
      return expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: 'GET /',
          response: {
            headers: {
              'content-length': 5
            },
            body: new Buffer('hello')
          }
        },
        'to yield response',
        200
      );
    });

    it('should treat Transfer-Encoding case insentitively', () => {
      return expect(
        () => {
          return expect.promise(run => {
            issueGetAndConsume('http://www.google.com/', run(() => {}));
          });
        },
        'with http mocked out',
        {
          request: 'GET /',
          response: {
            headers: {
              'transfer-encoding': 'chunked',
              'content-length': 1
            },
            body: fs.createReadStream(
              pathModule.resolve(__dirname, '..', 'testdata', 'foo.txt')
            )
          }
        },
        'not to error'
      );
    });

    describe('that emits an error', () => {
      it('should propagate the error to the mocked-out HTTP response', () => {
        var erroringStream = new stream.Readable();
        erroringStream._read = (num, cb) => {
          setImmediate(() => {
            erroringStream.emit('error', new Error('Fake error'));
          });
        };
        return expect(
          'GET http://www.google.com/',
          'with http mocked out',
          {
            request: 'GET http://www.google.com/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: erroringStream
            }
          },
          'to yield response',
          new Error('Fake error')
        );
      });

      it('should support a stream that emits some data, then errors out', () => {
        var responseBodyStream = new stream.Readable();
        responseBodyStream._read = (num, cb) => {
          responseBodyStream._read = () => {};
          setImmediate(() => {
            responseBodyStream.push('foobarquux');
            responseBodyStream.emit('error', new Error('Fake error'));
          });
        };

        return expect(
          'GET http://localhost/',
          'with http mocked out',
          {
            request: 'GET http://localhost/',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: responseBodyStream
            }
          },
          'to yield response',
          {
            body: 'foobarquux',
            error: new Error('Fake error')
          }
        );
      });

      it('should recover from the error and replay the next request', () => {
        var erroringStream = new stream.Readable();
        erroringStream._read = num => {
          erroringStream._read = () => {};
          erroringStream.push('yaddayadda');
          setImmediate(() => {
            erroringStream.emit('error', new Error('Fake error'));
          });
        };
        var firstResponseSpy = sinon.spy();
        return expect(
          () => {
            return expect.promise(run => {
              http
                .get('http://www.google.com/')
                .on(
                  'error',
                  run(() => {
                    expect(firstResponseSpy, 'to have calls satisfying', () => {
                      firstResponseSpy({
                        headers: { 'content-type': 'text/plain' }
                      });
                    });
                    http
                      .get('http://www.google.com/')
                      .on('error', () => {
                        expect.fail('request unexpectedly errored');
                      })
                      .on('response', run(() => {}))
                      .end();
                  })
                )
                .on('response', run(firstResponseSpy))
                .end();
            });
          },
          'with http mocked out',
          [
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: erroringStream
              }
            },
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'abcdef'
              }
            }
          ],
          'not to error'
        );
      });
    });
  });

  it('should error if the request body provided for verification was a stream', () => {
    return expect(
      expect(
        'http://www.google.com/',
        'with http mocked out',
        {
          request: {
            url: 'GET /',
            body: fs.createReadStream(
              pathModule.resolve(__dirname, '..', 'testdata', 'foo.txt')
            )
          },
          response: 200
        },
        'to yield response',
        {
          statusCode: 200
        }
      ),
      'when rejected',
      'to have message',
      'unexpected-mitm: a stream cannot be used to verify the request body, please specify the buffer instead.'
    );
  });

  describe('with the expected request body given as an object (shorthand for JSON)', () => {
    it('should succeed the match', () => {
      return expect(
        {
          url: 'POST http://www.google.com/',
          body: { foo: 123 }
        },
        'with http mocked out',
        {
          request: {
            url: 'POST /',
            body: { foo: 123 }
          },
          response: 200
        },
        'to yield response',
        200
      );
    });

    it('should fail with a diff', () => {
      return expect(
        expect(
          {
            url: 'POST http://www.google.com/',
            body: { foo: 123 }
          },
          'with http mocked out',
          {
            request: {
              url: 'POST /',
              body: { foo: 456 }
            },
            response: 200
          },
          'to yield response',
          200
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            trimDiff(message),
            'to equal',
            "expected { url: 'POST http://www.google.com/', body: { foo: 123 } }\n" +
              "with http mocked out { request: { url: 'POST /', body: { foo: 456 } }, response: 200 } to yield response 200\n" +
              '\n' +
              'POST / HTTP/1.1\n' +
              'Host: www.google.com\n' +
              'Content-Type: application/json\n' +
              '\n' +
              '{\n' +
              '  foo: 123 // should equal 456\n' +
              '}\n' +
              '\n' +
              'HTTP/1.1 200 OK'
          );
        }
      );
    });
  });

  it('should produce a JSON response if the response body is given as an object', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: { body: { foo: 123 } }
      },
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: { foo: 123 }
      }
    );
  });

  it('should produce a JSON response if the response body is given as an array', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: { body: [{ foo: 123 }] }
      },
      'to yield response',
      {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: [{ foo: 123 }]
      }
    );
  });

  it('should produce an error if the request conditions are not satisfied', () => {
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        {
          request: 'GET /bar',
          response: 200
        },
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo' with http mocked out { request: 'GET /bar', response: 200 } to yield response 200\n" +
            '\n' +
            'GET /foo HTTP/1.1 // should be GET /bar\n' +
            '                  //\n' +
            '                  // -GET /foo HTTP/1.1\n' +
            '                  // +GET /bar HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK'
        );
      }
    );
  });

  it('should produce an error if a mocked request is not exercised', () => {
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        [
          {
            request: 'GET /foo',
            response: 200
          },
          {
            request: 'GET /foo',
            response: 200
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo'\n" +
            "with http mocked out [ { request: 'GET /foo', response: 200 }, { request: 'GET /foo', response: 200 } ] to yield response 200\n" +
            '\n' +
            'GET /foo HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            '\n' +
            '// missing:\n' +
            '// GET /foo\n' +
            '//\n' +
            '// HTTP/1.1 200 OK'
        );
      }
    );
  });

  it('should produce an error if a mocked request is not exercised and the second mock has a stream', () => {
    var responseBodyStream = new stream.Readable();
    responseBodyStream._read = (num, cb) => {
      responseBodyStream._read = () => {};
      setImmediate(() => {
        responseBodyStream.push('foobarquux');
        responseBodyStream.push(null);
      });
    };
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        [
          {
            request: 'GET /foo',
            response: 200
          },
          {
            request: 'GET /foo',
            response: {
              body: responseBodyStream
            }
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo'\n" +
            "with http mocked out [ { request: 'GET /foo', response: 200 }, { request: 'GET /foo', response: { body: ... } } ] to yield response 200\n" +
            '\n' +
            'GET /foo HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            '\n' +
            '// missing:\n' +
            '// GET /foo\n' +
            '//\n' +
            '// HTTP/1.1 200 OK\n' +
            '//\n' +
            '// Buffer([0x66, 0x6F, 0x6F, 0x62, 0x61, 0x72, 0x71, 0x75, 0x75, 0x78])'
        );
      }
    );
  });

  it('should decode the textual body if a mocked request is not exercised', () => {
    var responseBodyStream = new stream.Readable();
    responseBodyStream._read = (num, cb) => {
      responseBodyStream._read = () => {};
      setImmediate(() => {
        responseBodyStream.push('foobarquux');
        responseBodyStream.push(null);
      });
    };
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        [
          {
            request: 'GET /foo',
            response: 200
          },
          {
            request: 'GET /foo',
            response: {
              headers: {
                'Content-Type': 'text/plain'
              },
              body: responseBodyStream
            }
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo'\n" +
            "with http mocked out [ { request: 'GET /foo', response: 200 }, { request: 'GET /foo', response: { headers: ..., body: ... } } ] to yield response 200\n" +
            '\n' +
            'GET /foo HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            '\n' +
            '// missing:\n' +
            '// GET /foo\n' +
            '//\n' +
            '// HTTP/1.1 200 OK\n' +
            '// Content-Type: text/plain\n' +
            '//\n' +
            '// foobarquux'
        );
      }
    );
  });

  it('should produce an error if a mocked request is not exercised with an expected request stream', () => {
    var requestBodyStream = new stream.Readable();
    requestBodyStream._read = (num, cb) => {
      requestBodyStream._read = () => {};
      setImmediate(() => {
        requestBodyStream.push('foobarquux');
        requestBodyStream.push(null);
      });
    };
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        [
          {
            request: 'GET /foo',
            response: 200
          },
          {
            request: {
              body: requestBodyStream
            },
            response: 200
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      'unexpected-mitm: a stream cannot be used to verify the request body, please specify the buffer instead.'
    );
  });

  it('should produce an error if a mocked request is not exercised and there are non-trivial assertions on it', () => {
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        [
          {
            request: 'GET /foo',
            response: 200
          },
          {
            request: {
              url: 'GET /foo',
              headers: { Foo: expect.it('to match', /bar/) }
            },
            response: 200
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo'\n" +
          "with http mocked out [ { request: 'GET /foo', response: 200 }, { request: { url: 'GET /foo', headers: ... }, response: 200 } ] to yield response 200\n" +
          '\n' +
          'GET /foo HTTP/1.1\n' +
          'Host: www.google.com\n' +
          '\n' +
          'HTTP/1.1 200 OK\n' +
          '\n' +
          '// missing:\n' +
          '// GET /foo\n' +
          "// Foo: // should satisfy expect.it('to match', /bar/)\n" +
          '//      //\n' +
          "//      // expected '' to match /bar/\n" + // Hmm, this is not ideal
            '//\n' +
            '// HTTP/1.1 200 OK'
        );
      }
    );
  });

  it('should produce an error if a mocked request is not exercised and there are failing async expects', () => {
    return expect(
      expect(
        {
          url: 'POST http://www.google.com/foo',
          body: { foo: 123 }
        },
        'with http mocked out',
        [
          {
            request: {
              url: 'POST /foo',
              body: expect.it('when delayed a little bit', 'to equal', {
                foo: 123
              })
            },
            response: 200
          },
          {
            request: {
              url: 'GET /foo',
              headers: { Foo: expect.it('to match', /bar/) }
            },
            response: 200
          }
        ],
        'to yield response',
        200
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected { url: 'POST http://www.google.com/foo', body: { foo: 123 } } with http mocked out\n" +
            '[\n' +
            "  { request: { url: 'POST /foo', body: expect.it('when delayed a little bit', 'to equal', ...) }, response: 200 },\n" +
            "  { request: { url: 'GET /foo', headers: ... }, response: 200 }\n" +
            '] to yield response 200\n' +
            '\n' +
            'POST /foo HTTP/1.1\n' +
            'Host: www.google.com\n' +
            'Content-Type: application/json\n' +
            'Content-Length: 11\n' +
            '\n' +
            '{ foo: 123 }\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            '\n' +
            '// missing:\n' +
            '// GET /foo\n' +
            "// Foo: // should satisfy expect.it('to match', /bar/)\n" +
            '//      //\n' +
            "//      // expected '' to match /bar/\n" +
            '//\n' +
            '// HTTP/1.1 200 OK'
        );
      }
    );
  });

  describe('when the test suite issues more requests than have been mocked out', () => {
    it('should produce an error', () => {
      return expect(
        expect(
          'http://www.google.com/foo',
          'with http mocked out',
          [],
          'to yield response',
          200
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            message.replace(/^\/\/ Connection:.*\n/m, ''),
            'to equal',
            "expected 'http://www.google.com/foo' with http mocked out [] to yield response 200\n" +
              '\n' +
              '// should be removed:\n' +
              '// GET /foo HTTP/1.1\n' +
              '// Host: www.google.com\n' +
              '// Content-Length: 0\n' +
              '//\n' +
              '// <no response>'
          );
        }
      );
    });

    it('should produce an error and decode the textual body', () => {
      return expect(
        expect(
          {
            url: 'http://www.google.com/foo',
            headers: {
              'Content-Type': 'text/plain'
            },
            body: 'quux & xuuq'
          },
          'with http mocked out',
          [],
          'to yield response',
          200
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            message.replace(/^\/\/ Connection:.*\n/m, ''),
            'to equal',
            "expected { url: 'http://www.google.com/foo', headers: { 'Content-Type': 'text/plain' }, body: 'quux & xuuq' }\n" +
              'with http mocked out [] to yield response 200\n' +
              '\n' +
              '// should be removed:\n' +
              '// GET /foo HTTP/1.1\n' +
              '// Content-Type: text/plain\n' +
              '// Host: www.google.com\n' +
              '// Content-Length: 11\n' +
              '//\n' +
              '// quux & xuuq\n' +
              '//\n' +
              '// <no response>'
          );
        }
      );
    });

    it('should produce an error as soon as the first request is issued, even when the test issues more requests later', () => {
      return expect(
        expect(
          () => {
            return expect(
              'http://www.google.com/foo',
              'to yield response',
              200
            ).then(() => {
              return expect(
                'http://www.google.com/foo',
                'to yield response',
                200
              );
            });
          },
          'with http mocked out',
          [],
          'not to error'
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            message.replace(/^\/\/ Connection:.*\n/m, ''),
            'to equal',
            'expected\n' +
              'function () {\n' +
              '  return expect(\n' +
              "    'http://www.google.com/foo',\n" +
              "    'to yield response',\n" +
              '    // ... lines removed ...\n' +
              '      200\n' +
              '    );\n' +
              '  });\n' +
              '}\n' +
              'with http mocked out [] not to error\n' +
              '\n' +
              '// should be removed:\n' +
              '// GET /foo HTTP/1.1\n' +
              '// Host: www.google.com\n' +
              '// Content-Length: 0\n' +
              '//\n' +
              '// <no response>'
          );
        }
      );
    });
  });

  it('should not mangle the requestDescriptions array', () => {
    var requestDescriptions = [{ request: 'GET /', response: 200 }];
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      requestDescriptions,
      'to yield response',
      200
    ).then(() => {
      expect(requestDescriptions, 'to have length', 1);
    });
  });

  it('should output the error if the assertion being delegated to fails', () => {
    return expect(
      expect(
        'http://www.google.com/foo',
        'with http mocked out',
        {
          request: 'GET /foo',
          response: 200
        },
        'to yield response',
        412
      ),
      'when rejected',
      'to have message',
      message => {
        expect(
          trimDiff(message),
          'to equal',
          "expected 'http://www.google.com/foo' with http mocked out { request: 'GET /foo', response: 200 } to yield response 412\n" +
            '\n' +
            'GET /foo HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK // should be 412 Precondition Failed\n'
        );
      }
    );
  });

  describe('with response function', () => {
    it('should allow returning a response in callback', () => {
      var cannedResponse = {
        statusCode: 404
      };

      return expect(
        'GET /404',
        'with http mocked out',
        {
          request: 'GET /404',
          response: function(req, res) {
            res.statusCode =
              req.url === '/404' ? cannedResponse.statusCode : 200;

            res.end();
          }
        },
        'to yield response',
        cannedResponse
      );
    });

    it('should allow returning a response with a body Buffer', () => {
      var expectedBuffer = new Buffer([0xc3, 0xa6, 0xc3, 0xb8, 0xc3, 0xa5]);

      return expect(
        '/200',
        'with http mocked out with extra info',
        {
          request: {
            method: 'GET',
            url: '/200'
          },
          response: function(req, res) {
            res.end(expectedBuffer);
          }
        },
        'to yield response',
        {
          body: expectedBuffer
        }
      ).spread((fulfilmentValue, httpConversation) => {
        expect(
          httpConversation.exchanges[0],
          'to have a response with body',
          expectedBuffer
        );
      });
    });

    it('should allow returning a response with a body Array', () => {
      var expectedArray = [null, {}, { foo: 'bar' }];

      return expect(
        '/200',
        'with http mocked out with extra info',
        {
          request: {
            method: 'GET',
            url: '/200'
          },
          response: function(req, res) {
            res.writeHead(200, {
              'Content-Type': 'application/json'
            });

            res.end(new Buffer(JSON.stringify(expectedArray)));
          }
        },
        'to yield response',
        {
          body: expectedArray
        }
      ).spread((fulfilmentValue, httpConversation) => {
        expect(
          httpConversation.exchanges[0],
          'to have a response with body',
          expectedArray
        );
      });
    });

    it('should allow returning a response with a body Object', () => {
      var expectedBody = {
        foo: 'bar'
      };

      return expect(
        '/200',
        'with http mocked out with extra info',
        {
          request: {
            method: 'GET',
            url: '/200'
          },
          response: function(req, res) {
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf8'
            });

            res.end(new Buffer(JSON.stringify(expectedBody)));
          }
        },
        'to yield response',
        {
          body: expectedBody
        }
      ).spread((fulfilmentValue, httpConversation) => {
        expect(
          httpConversation.exchanges[0],
          'to have a response with body',
          expectedBody
        );
      });
    });

    it('should allow consuming the request body', () => {
      var expectedBody = {
        foo: 'bar'
      };

      return expect(
        {
          url: 'POST /',
          body: expectedBody
        },
        'with http mocked out with extra info',
        {
          response: require('express')()
            .use(require('body-parser').json())
            .use((req, res, next) => {
              res.send(req.body);
            })
        },
        'to yield response',
        {
          body: expectedBody
        }
      ).spread((fulfilmentValue, httpConversation) => {
        expect(
          httpConversation.exchanges[0],
          'to have a response with body',
          expectedBody
        );
      });
    });

    it('should allow the use of pipe() internally', () => {
      var expectedBuffer = new Buffer('foobar', 'utf-8');

      return expect(
        {
          url: 'GET /stream',
          body: expectedBuffer
        },
        'with http mocked out with extra info',
        {
          request: {
            url: '/stream',
            body: expectedBuffer
          },
          response: function(req, res) {
            req.pipe(res);
          }
        },
        'to yield response',
        {
          body: expectedBuffer
        }
      ).spread((fulfilmentValue, httpConversation) => {
        expect(
          httpConversation.exchanges[0],
          'to have a response with body',
          expectedBuffer
        );
      });
    });

    it('should report if the response function returns an error', () => {
      var err = new Error('bailed');

      return expect(
        expect(
          '/404',
          'with http mocked out',
          {
            request: {
              method: 'GET',
              url: '/404'
            },
            response: function(req, res) {
              throw err;
            }
          },
          'to yield response',
          200
        ),
        'when rejected',
        'to be',
        err
      );
    });

    describe('with documentation response function', () => {
      function documentationHandler(req, res) {
        var myMessage;

        if (req.url === '/thatOneExpectedThing') {
          myMessage = '<h1>to be expected</h1>';
        } else {
          myMessage = '<h1>how very unexpected</h1>';
        }

        res.writeHead(200, {
          'Content-Type': 'text/plain'
        });
        res.end(myMessage);
      }

      it('should remark "to be expected" for GET /thatOneExpectedThing', () => {
        return expect(
          '/thatOneExpectedThing',
          'with http mocked out',
          {
            request: '/thatOneExpectedThing',
            response: documentationHandler
          },
          'to yield response',
          {
            statusCode: 200,
            body: '<h1>to be expected</h1>'
          }
        );
      });

      it('should remark "how very unexpected" for GET /somethingOtherThing', () => {
        return expect(
          '/somethingOtherThing',
          'with http mocked out',
          {
            request: '/somethingOtherThing',
            response: documentationHandler
          },
          'to yield response',
          {
            statusCode: 200,
            body: '<h1>how very unexpected</h1>'
          }
        );
      });
    });
  });

  describe('wíth a client certificate', () => {
    describe('when asserting on ca/cert/key', () => {
      it('should succeed', () => {
        return expect(
          {
            url: 'https://www.google.com/foo',
            cert: new Buffer([1]),
            key: new Buffer([2]),
            ca: new Buffer([3])
          },
          'with http mocked out',
          {
            request: {
              url: 'GET /foo',
              cert: new Buffer([1]),
              key: new Buffer([2]),
              ca: new Buffer([3])
            },
            response: 200
          },
          'to yield response',
          200
        );
      });

      it('should fail with a meaningful error message', () => {
        return expect(
          expect(
            {
              url: 'https://www.google.com/foo',
              cert: new Buffer([1]),
              key: new Buffer([2]),
              ca: new Buffer([3])
            },
            'with http mocked out',
            {
              request: {
                url: 'GET /foo',
                cert: new Buffer([1]),
                key: new Buffer([5]),
                ca: new Buffer([3])
              },
              response: 200
            },
            'to yield response',
            200
          ),
          'when rejected',
          'to have message',
          message => {
            expect(
              trimDiff(message),
              'to equal',
              "expected { url: 'https://www.google.com/foo', cert: Buffer([0x01]), key: Buffer([0x02]), ca: Buffer([0x03]) }\n" +
                "with http mocked out { request: { url: 'GET /foo', cert: Buffer([0x01]), key: Buffer([0x05]), ca: Buffer([0x03]) }, response: 200 } to yield response 200\n" +
                '\n' +
                'GET /foo HTTP/1.1\n' +
                'Host: www.google.com\n' +
                '// key: expected Buffer([0x02]) to equal Buffer([0x05])\n' +
                '//\n' +
                '// -02                                               │.│\n' +
                '// +05                                               │.│\n' +
                '\n' +
                'HTTP/1.1 200 OK'
            );
          }
        );
      });
    });
  });

  describe('in recording mode against a local HTTP server', () => {
    var handleRequest, server, serverAddress, serverHostname, serverUrl;
    beforeEach(() => {
      handleRequest = undefined;
      server = http
        .createServer((req, res) => {
          res.sendDate = false;
          handleRequest(req, res);
        })
        .listen(0);
      serverAddress = server.address();
      serverHostname =
        serverAddress.address === '::' ? 'localhost' : serverAddress.address;
      serverUrl = 'http://' + serverHostname + ':' + serverAddress.port + '/';
    });

    afterEach(() => {
      server.close();
    });

    it('should record', () => {
      handleRequest = (req, res) => {
        res.setHeader('Allow', 'GET, HEAD');
        res.statusCode = 405;
        res.end();
      };
      return expect(
        {
          url: 'POST ' + serverUrl,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'foo=bar'
        },
        'with expected http recording',
        {
          request: {
            host: serverHostname,
            port: serverAddress.port,
            url: 'POST /',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Host: serverHostname + ':' + serverAddress.port
            },
            body: 'foo=bar'
          },
          response: {
            statusCode: 405,
            headers: {
              Allow: 'GET, HEAD'
            }
          }
        },
        'to yield response',
        405
      );
    });

    it('should preserve the fulfilment value', () => {
      return expect('foo', 'with http recorded', 'to match', /^(f)o/).then(
        matches => {
          expect(matches, 'to satisfy', { 0: 'fo', 1: 'f', index: 0 });
        }
      );
    });

    it('should not break on an exception from the request itself', () => {
      handleRequest = (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.statusCode = 200;
        res.end('hello');
      };

      return expect(
        expect(
          () => {
            return expect.promise
              .fromNode(cb => {
                issueGetAndConsume(serverUrl, cb);
              })
              .then(buffer => {
                expect(buffer.toString('utf-8'), 'to equal', 'hello world');
              });
          },
          'with http recorded',
          'not to error'
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            message,
            'to equal',
            'expected\n' +
              'function () {\n' +
              '  return expect.promise\n' +
              '    .fromNode(function(cb) {\n' +
              '      issueGetAndConsume(serverUrl, cb);\n' +
              '    })\n' +
              '    .then(function(buffer) {\n' +
              "      expect(buffer.toString('utf-8'), 'to equal', 'hello world');\n" +
              '    });\n' +
              '}\n' +
              'with http recorded not to error\n' +
              '  expected function not to error\n' +
              "    returned promise rejected with: expected 'hello' to equal 'hello world'\n" +
              '\n' +
              '    -hello\n' +
              '    +hello world'
          );
        }
      );
    });

    it('should record an error', () => {
      var expectedError;
      // I do not know the exact version where this change was introduced. Hopefully this is enough to get
      // it working on Travis (0.10.36 presently):
      var nodeJsVersion = process.version.replace(/^v/, '');
      if (nodeJsVersion === '0.10.29') {
        expectedError = new Error('getaddrinfo EADDRINFO');
        expectedError.code = expectedError.errno = 'EADDRINFO';
      } else if (semver.satisfies(nodeJsVersion, '>=0.12.0')) {
        var message =
          'getaddrinfo ENOTFOUND www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com';
        if (semver.satisfies(nodeJsVersion, '>=9.7.0 <10')) {
          expectedError = new Error();
          // explicitly set "message" to workaround an issue with enumerable properties
          expectedError.message = message;
        } else {
          expectedError = new Error(message);
        }
        if (semver.satisfies(nodeJsVersion, '>=2.0.0')) {
          expectedError.message +=
            ' www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com:80';
          expectedError.host = 'www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com';
          expectedError.port = 80;
        }
        expectedError.code = expectedError.errno = 'ENOTFOUND';
        expectedError.hostname = 'www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com';
      } else {
        expectedError = new Error('getaddrinfo ENOTFOUND');
        expectedError.code = expectedError.errno = 'ENOTFOUND';
      }
      expectedError.syscall = 'getaddrinfo';
      return expect(
        'http://www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com/',
        'with expected http recording',
        {
          request: {
            host: 'www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com',
            port: 80,
            url: 'GET /',
            headers: { Host: 'www.icwqjecoiqwjecoiwqjecoiwqjceoiwq.com' }
          },
          response: expectedError
        },
        'to yield response',
        expectedError
      );
    });

    it('should record a socket disconnect', () => {
      handleRequest = (req, res) => {
        res.destroy();
      };

      var expectedError = new Error('socket hang up');
      expectedError.code = 'ECONNRESET';

      return expect(
        {
          url: 'GET ' + serverUrl
        },
        'with expected http recording',
        {
          request: {
            url: 'GET /',
            host: serverHostname,
            port: serverAddress.port,
            headers: {
              Host: serverHostname + ':' + serverAddress.port
            }
          },
          response: expectedError
        },
        'to yield response',
        expectedError
      );
    });

    it('should recognize a Content-Type ending with +json as JSON, but preserve it in the recording', () => {
      handleRequest = (req, res) => {
        res.setHeader('Content-Type', 'application/vnd.api+json');
        res.end('{"foo": 123}');
      };
      return expect(
        'GET ' + serverUrl,
        'with expected http recording',
        {
          request: {
            url: 'GET /',
            host: serverHostname,
            port: serverAddress.port,
            headers: {
              Host: serverHostname + ':' + serverAddress.port
            }
          },
          response: {
            body: {
              foo: 123
            },
            headers: {
              'Content-Type': 'application/vnd.api+json'
            }
          }
        },
        'to yield response',
        200
      );
    });
  });

  describe('in injecting mode against a local HTTP server', () => {
    it('should record and inject', () => {
      return expect('testfile', 'when injected becomes', 'testfile-injected');
    });

    it('should record and inject textual injections', () => {
      return expect('utf8file', 'when injected becomes', 'utf8file-injected');
    });

    it('should record and inject into a compound assertion', () => {
      return expect('compound', 'when injected becomes', 'compound-injected');
    });

    it('should correctly handle buffer injections', () => {
      return expect(
        'bufferfile',
        'when injected becomes',
        'bufferfile-injected'
      );
    });

    it('should correctly handle long buffer injections (>32 octets should be base64 encoded)', () => {
      return expect(
        'longbufferfile',
        'when injected becomes',
        'longbufferfile-injected'
      );
    });

    it('should correctly handle error injections', () => {
      return expect('errorfile', 'when injected becomes', 'errorfile-injected');
    });

    it('should correctly handle multiple injections', () => {
      return expect(
        'multiplefile',
        'when injected becomes',
        'multiplefile-injected'
      );
    });
  });

  describe('in recording mode against a local HTTPS server', () => {
    var handleRequest, server, serverAddress, serverHostname, serverUrl;

    beforeEach(() => {
      return createPemCertificate({ days: 1, selfSigned: true }).then(
        serverKeys => {
          handleRequest = undefined;
          server = https
            .createServer({
              cert: serverKeys.certificate,
              key: serverKeys.serviceKey
            })
            .on('request', (req, res) => {
              res.sendDate = false;
              handleRequest(req, res);
            })
            .listen(0);
          serverAddress = server.address();
          serverHostname =
            serverAddress.address === '::'
              ? 'localhost'
              : serverAddress.address;
          serverUrl =
            'https://' + serverHostname + ':' + serverAddress.port + '/';
        }
      );
    });

    afterEach(() => {
      server.close();
    });

    describe('with a client certificate', () => {
      var clientKeys;

      var ca = new Buffer([1, 2, 3]); // Can apparently be bogus

      beforeEach(() => {
        return createPemCertificate({ days: 1, selfSigned: true }).then(
          keys => {
            clientKeys = keys;
          }
        );
      });

      it('should record a client certificate', () => {
        handleRequest = (req, res) => {
          res.setHeader('Allow', 'GET, HEAD');
          res.statusCode = 405;
          res.end();
        };

        return expect(
          {
            url: 'POST ' + serverUrl,
            rejectUnauthorized: false,
            cert: clientKeys.certificate,
            key: clientKeys.serviceKey,
            ca: ca
          },
          'with expected http recording',
          {
            request: {
              url: 'POST /',
              host: serverHostname,
              port: serverAddress.port,
              rejectUnauthorized: false,
              cert: clientKeys.certificate,
              key: clientKeys.serviceKey,
              ca: ca,
              headers: {
                Host: serverHostname + ':' + serverAddress.port
              }
            },
            response: {
              statusCode: 405,
              headers: {
                Allow: 'GET, HEAD'
              }
            }
          },
          'to yield response',
          405
        );
      });
    });
  });

  describe('in capturing mode', () => {
    var handleRequest, server, serverAddress, serverHostname, serverUrl;

    beforeEach(() => {
      handleRequest = undefined;
      server = http
        .createServer((req, res) => {
          res.sendDate = false;
          handleRequest(req, res);
        })
        .listen(0);
      serverAddress = server.address();
      serverHostname =
        serverAddress.address === '::' ? 'localhost' : serverAddress.address;
      serverUrl = 'http://' + serverHostname + ':' + serverAddress.port + '/';
    });

    afterEach(() => {
      server.close();
    });

    it('should resolve with delegated fulfilment', () => {
      handleRequest = (req, res) => {
        res.setHeader('Allow', 'GET, HEAD');
        res.statusCode = 405;
        res.end();
      };
      var outputFile = pathModule.resolve(
        __dirname,
        '..',
        'testdata',
        'capture.js'
      );

      // set env for write mode
      process.env.UNEXPECTED_MITM_WRITE = 'true';

      return expect(
        expect(
          {
            host: serverHostname,
            port: serverAddress.port,
            url: 'GET /',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Host: serverHostname + ':' + serverAddress.port
            },
            body: 'foo=bar'
          },
          'with http mocked out by file',
          outputFile,
          'to yield response',
          405
        ),
        'when fulfilled',
        'to satisfy',
        expect.it('to be an object')
      ).finally(() => {
        delete process.env.UNEXPECTED_MITM_WRITE;
      });
    });

    it('should capture the correct mocks', () => {
      handleRequest = (req, res) => {
        res.setHeader('Allow', 'GET, HEAD');
        res.statusCode = 405;
        res.end();
      };
      var outputFile = pathModule.resolve(
        __dirname,
        '..',
        'testdata',
        'capture.js'
      );

      // set env for write mode
      process.env.UNEXPECTED_MITM_WRITE = 'true';

      return expect(
        {
          request: {
            host: serverHostname,
            port: serverAddress.port,
            url: 'POST /',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Host: serverHostname + ':' + serverAddress.port
            },
            body: 'foo=bar'
          },
          response: {
            statusCode: 405,
            headers: {
              Allow: 'GET, HEAD'
            }
          }
        },
        'was written correctly on',
        {
          url: 'POST ' + serverUrl,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'foo=bar'
        },
        'with http mocked out by file with extra info',
        outputFile,
        'to yield response',
        405
      ).finally(() => {
        delete process.env.UNEXPECTED_MITM_WRITE;
      });
    });
  });

  describe('in replaying mode', () => {
    it('should resolve with delegated fulfilment', () => {
      var inputFile = '../testdata/replay.js';

      return expect(
        expect(
          {
            url: 'GET /'
          },
          'with http mocked out by file',
          inputFile,
          'to yield response',
          405
        ),
        'when fulfilled',
        'to satisfy',
        expect.it('to be an object')
      );
    });

    it('should replay the correct mocks', () => {
      var inputFile = '../testdata/replay.js';

      return expect(
        {
          response: {
            statusCode: 405,
            headers: {
              Allow: 'GET, HEAD'
            }
          }
        },
        'was read correctly on',
        {
          url: 'GET /'
        },
        'with http mocked out by file with extra info',
        inputFile,
        'to yield response',
        405
      );
    });

    it('should replay with delegated fulfilment', () => {
      var inputFile = '../testdata/replay-from-function.js';

      return expect(
        {
          request: {
            body: expect.it('to end with', '123')
          },
          response: {
            statusCode: 405,
            headers: {
              Allow: 'GET, HEAD'
            }
          }
        },
        'was read correctly on',
        {
          url: 'POST /',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: 'testing testing 123'
        },
        'with http mocked out by file with extra info',
        inputFile,
        'to yield response',
        405
      );
    });
  });

  it('should not overwrite an explicitly defined Host header in the expected request properties', () => {
    return expect(
      {
        url: 'GET http://localhost/',
        port: 456,
        headers: {
          Host: 'foobar:567'
        }
      },
      'with http mocked out',
      {
        request: {
          url: 'http://localhost/',
          headers: {
            Host: 'foobar:567'
          }
        },
        response: 200
      },
      'to yield response',
      200
    );
  });

  it('should interpret a response body provided as a non-Buffer object as JSON even though the message has a non-JSON Content-Type', () => {
    return expect(
      'http://www.google.com/',
      'with http mocked out',
      {
        request: 'GET /',
        response: {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          body: { foo: 'bar' }
        }
      },
      'to yield response',
      {
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: new Buffer('{"foo":"bar"}', 'utf-8')
      }
    );
  });

  describe('with the "with extra info" flag', () => {
    it('should resolve with the compared exchanges', () => {
      return expect(
        expect(
          'GET /',
          'with http mocked out with extra info',
          {
            request: 'GET /',
            response: 200
          },
          'to yield response',
          200
        ),
        'when fulfilled',
        'to satisfy',
        [
          expect.it('to be an object'),
          new messy.HttpExchange(),
          expect.it('to be an object')
        ]
      );
    });

    it('should output response headers preserving their original case', () => {
      return expect(
        'GET /',
        'with http mocked out with extra info',
        {
          response: {
            statusCode: 200,
            headers: {
              'X-Is-Test': 'yes'
            }
          }
        },
        'to yield response',
        200
      ).spread((fulfilmentValue, httpConversation) => {
        var httpResponse = httpConversation.exchanges[0].response;

        expect(httpResponse.headers.getNames(), 'to contain', 'X-Is-Test');
      });
    });
  });

  it('should preserve the fulfilment value of the promise returned by the assertion being delegated to', () => {
    return expect(
      [1, 2],
      'with http mocked out',
      [],
      'when passed as parameters to',
      Math.max
    ).then(value => {
      expect(value, 'to equal', 2);
    });
  });

  describe('when verifying', () => {
    var handleRequest, server, serverAddress, serverHostname, serverUrl;
    beforeEach(() => {
      handleRequest = undefined;
      server = http
        .createServer((req, res) => {
          handleRequest(req, res);
        })
        .listen(59891);
      serverAddress = server.address();
      serverHostname =
        serverAddress.address === '::' ? 'localhost' : serverAddress.address;
      serverUrl = 'http://' + serverHostname + ':' + serverAddress.port + '/';
    });

    afterEach(() => {
      server.close();
    });

    it('should verify and resolve with delegated fulfilment', () => {
      handleRequest = (req, res) => {
        res.statusCode = 405;
        res.end();
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified',
          {
            response: 405
          },
          'to yield response',
          405
        ),
        'when fulfilled',
        'to satisfy',
        expect.it('to be an object')
      );
    });

    it('should verify and resolve with extra info', () => {
      handleRequest = (req, res) => {
        res.statusCode = 405;
        res.end();
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified with extra info',
          {
            response: 405
          },
          'to yield response',
          405
        ),
        'when fulfilled',
        'to satisfy',
        [
          expect.it('to be an object'),
          new messy.HttpExchange(),
          expect.it('to be an object')
        ]
      );
    });

    it('should verify an ISO-8859-1 request', () => {
      handleRequest = (req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=ISO-8859-1');
        res.end(
          new Buffer([
            0x62,
            0x6c,
            0xe5,
            0x62,
            0xe6,
            0x72,
            0x67,
            0x72,
            0xf8,
            0x64
          ])
        );
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified',
          {
            response: {
              headers: {
                'Content-Type': 'text/html; charset=ISO-8859-1'
              },
              body: new Buffer([
                0x62,
                0x6c,
                0xe5,
                0x62,
                0xe6,
                0x72,
                0x67,
                0x72,
                0xf8,
                0x64
              ])
            }
          },
          'to yield response',
          200
        ),
        'to be fulfilled'
      );
    });

    it('should verify an object', () => {
      handleRequest = (req, res) => {
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(new Buffer(JSON.stringify({ foo: 'bar' })));
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified',
          {
            response: {
              statusCode: 201,
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                foo: 'bar'
              }
            }
          },
          'to yield response',
          {
            statusCode: 201,
            body: {
              foo: 'bar'
            }
          }
        ),
        'to be fulfilled'
      );
    });

    it('should allow excluding headers from verification', () => {
      handleRequest = (req, res) => {
        res.statusCode = 405;
        res.setHeader('X-Is-Test', 'yes');
        res.end();
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified',
          {
            response: 405,
            verify: {
              response: {
                ignoreHeaders: ['x-is-test']
              }
            }
          },
          'to yield response',
          405
        ),
        'to be fulfilled'
      );
    });

    it('should allow verify options on multiple mocks', () => {
      handleRequest = (req, res) => {
        res.statusCode = 405;
        res.setHeader('X-Is-Test', 'yes');
        res.end();

        // change handleRequest for next response
        handleRequest = (req, res) => {
          res.statusCode = 406;
          res.setHeader('X-So-Is-This', 'yep');
          res.end();
        };
      };

      return expect(
        expect(
          cb => {
            issueGetAndConsume(serverUrl, () => {
              issueGetAndConsume(serverUrl, cb);
            });
          },
          'with http mocked out and verified',
          [
            {
              request: 'GET /',
              response: 405,
              verify: {
                response: {
                  ignoreHeaders: ['X-Is-Test']
                }
              }
            },
            {
              request: 'GET /',
              response: 406,
              verify: {
                response: {
                  ignoreHeaders: ['X-So-Is-This']
                }
              }
            }
          ],
          'to call the callback without error'
        ),
        'to be fulfilled'
      );
    });

    it('should fail with a diff', () => {
      handleRequest = (req, res) => {
        res.statusCode = 406;
        res.end();
      };

      return expect(
        expect(
          {
            url: 'GET ' + serverUrl
          },
          'with http mocked out and verified',
          {
            response: 405
          },
          'to yield response',
          405
        ),
        'when rejected',
        'to have message',
        message => {
          expect(
            trimDiff(message),
            'to equal',
            'Explicit failure\n' +
              '\n' +
              'The mock and service have diverged.\n' +
              '\n' +
              "expected { url: 'GET " +
              serverUrl +
              "' } with http mocked out and verified { response: 405 } to yield response 405\n" +
              '\n' +
              'GET / HTTP/1.1\n' +
              'Host: ' +
              serverHostname +
              ':59891\n' +
              '\n' +
              'HTTP/1.1 405 Method Not Allowed // should be 406 Not Acceptable\n' +
              '                                //\n' +
              '                                // -HTTP/1.1 405 Method Not Allowed\n' +
              '                                // +HTTP/1.1 406 Not Acceptable\n'
          );
        }
      );
    });

    describe('with a mock in a file', () => {
      it('should verify and resolve with delegated fulfilment', () => {
        var testFile = pathModule.resolve(
          __dirname,
          '..',
          'testdata',
          'replay-and-verify.js'
        );
        handleRequest = (req, res) => {
          res.statusCode = 202;
          res.setHeader('X-Is-Test', 'yes');
          res.end();
        };

        return expect(
          expect(
            {
              url: 'GET ' + serverUrl
            },
            'with http mocked out by file and verified',
            testFile,
            'to yield response',
            202
          ),
          'when fulfilled',
          'to satisfy',
          expect.it('to be an object')
        );
      });
    });

    describe('using UNEXPECTED_MITM_VERIFY=true on the command line', () => {
      it('should be verified', () => {
        handleRequest = (req, res) => {
          res.statusCode = 406;
          res.end();
        };
        // set verification mode on the command line
        process.env.UNEXPECTED_MITM_VERIFY = 'true';

        return expect(
          expect(
            {
              url: 'GET ' + serverUrl
            },
            'with http mocked out',
            {
              response: 405
            },
            'to yield response',
            405
          ),
          'to be rejected'
        ).finally(() => {
          delete process.env.UNEXPECTED_MITM_VERIFY;
        });
      });

      it('should verify a mock in a file', () => {
        var testFile = pathModule.resolve(
          __dirname,
          '..',
          'testdata',
          'replay-and-verify.js'
        );
        handleRequest = (req, res) => {
          res.statusCode = 201;
          res.setHeader('X-Is-Test', 'yes');
          res.end();
        };

        // set verification mode on the command line
        process.env.UNEXPECTED_MITM_VERIFY = 'true';

        return expect(
          expect(
            {
              url: 'GET ' + serverUrl
            },
            'with http mocked out by file',
            testFile,
            'to yield response',
            202
          ),
          'when rejected',
          'to have message',
          message => {
            expect(trimDiff(message), 'to begin with', 'Explicit failure').and(
              'to contain',
              'The mock and service have diverged.'
            );
          }
        ).finally(() => {
          delete process.env.UNEXPECTED_MITM_VERIFY;
        });
      });
    });
  });

  it('should fail early, even when there are unexercised mocks', () => {
    return expect(
      () => {
        return expect(
          () => {
            return expect.promise(run => {
              issueGetAndConsume(
                'http://www.google.com/foo',
                run(() => {
                  issueGetAndConsume(
                    'http://www.google.com/',
                    run(() => {
                      throw new Error('Oh no');
                    })
                  );
                })
              );
            });
          },
          'with http mocked out',
          [
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'hello'
              }
            },
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'world'
              }
            }
          ],
          'not to error'
        );
      },
      'to be rejected with',
      err => {
        expect(
          trimDiff(err.getErrorMessage('text').toString()),
          'to equal',
          'expected\n' +
            'function () {\n' +
            '  return expect.promise(function(run) {\n' +
            '    issueGetAndConsume(\n' +
            "      'http://www.google.com/foo',\n" +
            '      // ... lines removed ...\n' +
            '      })\n' +
            '    );\n' +
            '  });\n' +
            '}\n' +
            'with http mocked out\n' +
            '[\n' +
            "  { request: 'GET http://www.google.com/', response: { headers: ..., body: 'hello' } },\n" +
            "  { request: 'GET http://www.google.com/', response: { headers: ..., body: 'world' } }\n" +
            '] not to error\n' +
            '\n' +
            'GET /foo HTTP/1.1 // should be GET /\n' +
            '                  //\n' +
            '                  // -GET /foo HTTP/1.1\n' +
            '                  // +GET / HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'Content-Type: text/plain\n' +
            '\n' +
            'hello'
        );
      }
    );
  });

  it('should fail a test as soon as an unexpected request is made, even if the code being tested ignores the request failing', () => {
    return expect(
      () => {
        return expect(
          run => {
            return expect.promise(run => {
              http.get('http://www.google.com/foo').on(
                'error',
                run(() => {
                  // Ignore error
                })
              );
            });
          },
          'with http mocked out',
          [
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'hello'
              }
            }
          ],
          'not to error'
        );
      },
      'to be rejected with',
      err => {
        expect(
          trimDiff(err.getErrorMessage('text').toString()),
          'to equal',
          'expected\n' +
            'function (run) {\n' +
            '  return expect.promise(function(run) {\n' +
            "    http.get('http://www.google.com/foo').on(\n" +
            "      'error',\n" +
            '      // ... lines removed ...\n' +
            '      })\n' +
            '    );\n' +
            '  });\n' +
            '}\n' +
            "with http mocked out [ { request: 'GET http://www.google.com/', response: { headers: ..., body: 'hello' } } ] not to error\n" +
            '\n' +
            'GET /foo HTTP/1.1 // should be GET /\n' +
            '                  //\n' +
            '                  // -GET /foo HTTP/1.1\n' +
            '                  // +GET / HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'Content-Type: text/plain\n' +
            '\n' +
            'hello'
        );
      }
    );
  });

  it('should fail a test as soon as an unexpected request is made, even if the code being tested ignores the request failing and fails with another error', () => {
    return expect(
      () => {
        return expect(
          () => {
            return expect.promise((resolve, reject) => {
              http.get('http://www.google.com/foo').on('error', () => {
                throw new Error('darn');
              });
            });
          },
          'with http mocked out',
          [
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'hello'
              }
            }
          ],
          'not to error'
        );
      },
      'to be rejected with',
      err => {
        expect(
          trimDiff(err.getErrorMessage('text').toString()),
          'to equal',
          'expected\n' +
            'function () {\n' +
            '  return expect.promise(function(resolve, reject) {\n' +
            "    http.get('http://www.google.com/foo').on('error', function() {\n" +
            "      throw new Error('darn');\n" +
            '    });\n' +
            '  });\n' +
            '}\n' +
            "with http mocked out [ { request: 'GET http://www.google.com/', response: { headers: ..., body: 'hello' } } ] not to error\n" +
            '\n' +
            'GET /foo HTTP/1.1 // should be GET /\n' +
            '                  //\n' +
            '                  // -GET /foo HTTP/1.1\n' +
            '                  // +GET / HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'Content-Type: text/plain\n' +
            '\n' +
            'hello'
        );
      }
    );
  });

  it('should fail a test as soon as an unexpected request is made, even if the code being tested ignores the request failing and fails with an uncaught exception', () => {
    return expect(
      () => {
        return expect(
          cb => {
            http.get('http://www.google.com/foo').on('error', () => {
              setImmediate(() => {
                throw new Error('darn');
              });
            });
          },
          'with http mocked out',
          [
            {
              request: 'GET http://www.google.com/',
              response: {
                headers: {
                  'Content-Type': 'text/plain'
                },
                body: 'hello'
              }
            }
          ],
          'to call the callback without error'
        );
      },
      'to be rejected with',
      err => {
        expect(
          trimDiff(err.getErrorMessage('text').toString()),
          'to equal',
          'expected\n' +
            'function (cb) {\n' +
            "  http.get('http://www.google.com/foo').on('error', function() {\n" +
            '    setImmediate(function() {\n' +
            "      throw new Error('darn');\n" +
            '    });\n' +
            '  });\n' +
            '}\n' +
            "with http mocked out [ { request: 'GET http://www.google.com/', response: { headers: ..., body: 'hello' } } ] to call the callback without error\n" +
            '\n' +
            'GET /foo HTTP/1.1 // should be GET /\n' +
            '                  //\n' +
            '                  // -GET /foo HTTP/1.1\n' +
            '                  // +GET / HTTP/1.1\n' +
            'Host: www.google.com\n' +
            '\n' +
            'HTTP/1.1 200 OK\n' +
            'Content-Type: text/plain\n' +
            '\n' +
            'hello'
        );
      }
    );
  });

  it('should handle concurrent requests without confusing the Host headers', () => {
    return expect(
      () => {
        return expect.promise((resolve, reject) => {
          var urls = ['http://www.google.com/', 'http://www.bing.com/'];
          var numInFlight = 0;
          urls.forEach(url => {
            numInFlight += 1;
            issueGetAndConsume(url, () => {
              numInFlight -= 1;
              if (numInFlight === 0) {
                resolve();
              }
            });
          });
        });
      },
      'with http mocked out',
      [
        {
          request: {
            host: 'www.google.com',
            headers: { Host: 'www.google.com' }
          },
          response: 200
        },
        {
          request: { host: 'www.bing.com', headers: { Host: 'www.bing.com' } },
          response: 200
        }
      ],
      'not to error'
    );
  });

  it('should be unaffected by modifications to the mocks array after initiating the assertion', () => {
    var mocks = [];

    return expect(
      () => {
        return expect(
          cb => {
            mocks.push({ request: 'GET /', response: 200 });
            issueGetAndConsume('http://www.example.com/', cb);
          },
          'with http mocked out',
          mocks,
          'to call the callback without error'
        );
      },
      'to error with',
      /\/\/ should be removed:/
    );
  });

  it('should not break when a response mocked out by an Error instance with extra properties is checked against the actual exchanges at the end', () => {
    var err = new Error('foo');
    err.bar = 123;
    err.statusCode = 404;
    return expect(
      expect(
        cb => {
          setImmediate(cb);
        },
        'with http mocked out',
        { request: 'GET /', response: err },
        'to call the callback without error'
      ),
      'to be rejected with',
      'expected function (cb) { setImmediate(cb); }\n' +
        "with http mocked out { request: 'GET /', response: Error({ message: 'foo', bar: 123, statusCode: 404 }) } to call the callback without error\n" +
        '\n' +
        '// missing:\n' +
        '// GET /\n' +
        '//\n' +
        '// 404'
    );
  });
});
