#!/usr/local/bin/node
var express = require('express');
var app = express();
var request = require('request');
var fs = require('fs');
var crypto = require('crypto');
var _ = require('lodash');

var defaultSettings = {
  users: []
};
var settings;
fs.readFile('./settings.json', function (err, data) {
  if (err) {
    settings = defaultSettings;
  } else {
    settings = _.defaults(JSON.parse(data), defaultSettings);
  }
});


// gather raw POST|PUT bodies
app.use(function (req, res, next) {
  req.rawBody = '';
  req.setEncoding('utf8');

  req.on('data', function (chunk) {
    req.rawBody += chunk;
  });

  req.on('end', function () {
    next();
  });
});

app.get('/favicon.ico', function (req, res) {
  res.status(404).send();
});


// parse incomding auth info assign req.user = the authed user
app.use(function (req, res, next) {
  if (req.headers.authorization) {
    var token = req.headers.authorization.split(' ')[1];
    settings.users.forEach(function (user) {
      if (user.token === token) {
        req.user = user;
      }
    })
  }

  next();
});


// handle publishing of packages
// check registry upstream to make sure the package does not exist?
app.put('/:package', function (req, res) {
  var pkgData = JSON.parse(req.rawBody);

  // create all the files posted to us
  var files = Object.keys(pkgData._attachments);
  files.forEach(function (fileName) {
    // make a directory under published for the package name
    var dir = './published/' + req.params.package;
    fs.mkdir(dir, function (e, d) {

      var file = dir + '/' + fileName;
      fs.writeFileSync(file, new Buffer(pkgData._attachments[fileName].data, 'base64'));
      delete pkgData._attachments[fileName];
    });
  });

  // create the record for the published package
  var packagejson = './published/' + req.params.package + '.json';
  fs.readFile(packagejson, function (err, data) {
    if (err) {
      //first publish
      fs.writeFileSync(packagejson, JSON.stringify(pkgData, null, 4));
    } else {
      //additional publish
      fs.readFile(packagejson, function (err, data) {
        var obj = JSON.parse(data);
        var newObj = {};
        _.merge(newObj, obj, pkgData);
        fs.writeFileSync(packagejson, JSON.stringify(newObj, null, 4));
      })
    }

    res.status(201).json({ok: 'created or updated'});
  });

});

var adminInterfaceRouter = express.Router();

adminInterfaceRouter.get('/', function (req, res) {

  res.send('ok');
});

app.use('/snr', adminInterfaceRouter);

app.get('/', function (req, res) {
  res.redirect('/snr');
});


// User Auth   npm login | npm adduser
app.put('/-/user/org.couchdb.user:*', function (req, res) {
  var data = JSON.parse(req.rawBody);
  data.password = crypto.createHash('sha1').update(data.password).digest('hex');

  var found = false;
  settings.users.forEach(function (user) {
    if (user.name === data.name && user.email === data.email) {
      found = true;

      if (user.password === data.password) {
        output(user);
      } else {
        res.status(401).json({"ok": false, "id": "org.couchdb.user:undefined"});
      }

      return FALSE;
    }
  });

  if (!found) {
    var user = {
      name: data.name,
      email: data.email,
      password: data.password
    };
    user.token = crypto.createHash('sha1').update(JSON.stringify(user)).digest('hex');
    settings.users.push(user);
    saveSettings();

    output(user);
  }

  function output(user) {
    res.status(201).json({
      ok: true,
      id: "org.couchdb.user:undefined",
      rev: "_we_dont_use_revs_any_more",
      token: user.token
    });
  }

  /*
   request({
     url: 'https://registry.npmjs.org' + req.url,
     method: 'PUT',
     body: req.rawBody,
     headers: {
      'content-type': 'application/json'
     }
   }, function(e, r, b) {

   if (e) {
     console.log('put user error', e)

     res.send('asf')
   } else {

     console.log('auth looks like ', b, r.statusCode)


     res.status(r.statusCode).send(b);
   }

   })*/

})

// save the settings object back to its file
function saveSettings() {
  fs.writeFileSync('./settings.json', JSON.stringify(settings, null, 4));
}


// File Download Proxy
app.get('/_dl', function (req, res) {
  var url = new Buffer(req.query.path, 'base64').toString('ascii');
  var filename = url.substr(url.lastIndexOf('/') + 1);

  console.log('Downloading: ', url)

  fs.readFile('cache/' + req.query.sha, function (err, data) {
    if (err) {
      // cache for file does not exist, grab the remote file and, cache it, and return it
      request({
        url     : url,
        method  : req.method,
        encoding: null
      }, function (e, r, b) {
        if (!e && r.statusCode === 200) {
          fs.writeFileSync('cache/' + req.query.sha, b);

          sendFile(b, filename);
        } else {
          res.status(404).send('');
        }
      });
    } else {
      //return cached file
      sendFile(data, filename)
    }
  });
});

function sendFile(file, filename) {
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename=' + filename);

  res.end(file, 'binary');
}

// Downloads for published packages
app.get('/:package/-/:filename', function (req, res) {
  fs.readFile('./published/' + req.params.package + '/' + req.params.filename, function (err, data) {
    if (err) {
      console.log('no file');
      res.status(404).send();
    } else {
      sendFile(data, req.params.filename);
    }
  });

});


// should cache the json response and use it if the registry is ever down
// only versions that have been downloaded will work though
// could filter all versions based on what files are available

app.all('*', function (req, res) {
  console.log('incoming', req.method, req.url)

  fs.readFile('./published' + req.url + '.json', function (err, data) {
    if (err) {

      // no local package, forward to npmjs
      request({
        url: 'https://registry.npmjs.org' + req.url,
        method: req.method
      }, function (e, r, b) {
        if (!e && r.statusCode === 200) {
          b = prepout(b);
          fs.writeFileSync('./cache' + req.url + '.json', JSON.stringify(b, null, 4));
          res.json(b);
        } else {
          // try to send cached output
          fs.readFile('./cache' + req.url + '.json', function(err, data) {
            if (err) {
              res.status(r.statusCode).send(b);
            } else {
              res.status(200).send(data);
            }
          });
        }
      });

    } else {

      // published modules do not need paths changed
      res.set('content-type', 'text/html');
      res.send(data);
    }
  });

  function prepout(b) {
    var data = JSON.parse(b);
    var versions = Object.keys(data.versions);
    versions.forEach(function (ver) {
      data.versions[ver].dist.tarball = parseDist(data.versions[ver].dist);
    });

    return data;
  }


});


function parseDist(dist) {
  var path = new Buffer(dist.tarball).toString('base64')

  return 'http://localhost/_dl?path=' + path + '&sha=' + dist.shasum
}


app.listen(80, function () {
  console.log('Example app listening on port 80!');
});

