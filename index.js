var express = require('express');
var app = express();
var request = require('request');
var fs = require('fs');
var bodyParser = require('body-parser');

// gather raw POST|PUT bodies
app.use(function(req, res, next) {
  req.rawBody = '';
  req.setEncoding('utf8');

  req.on('data', function(chunk) {
    req.rawBody += chunk;
  });

  req.on('end', function() {
    next();
  });
});

// parse incomding auth info
app.use(function(req, res, next) {

  if (req.headers.authorization) {
    console.log('incoming auth: ', req.headers.authorization);
  }

  next();
});


// handle publishing of packages
app.put('/:package', function(req, res) {

  console.log('package put', req.headers, req.rawBody)

  res.send('asfd');
})




// User Auth   npm login | npm adduser
app.put('/-/user/org.couchdb.user:*', function(req, res) {

  console.log('user put', req.headers, req.rawBody);

  //failed login = {"ok":false,"error":"Unknown error while authenticating"}

  // wrong user/pass {"ok":false,"id":"org.couchdb.user:undefined"} 401 

  // createed user = 201
  // {"ok":true,"id":"org.couchdb.user:undefined","rev":"_we_dont_use_revs_any_more","token":"b0ac7745-77f4-4030-8b84-200e6495d46c"}
  

  // store user name and pw , then issue a token for later lookup of whos token it is.



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

  })

})


// File Download Proxy
app.get('/_dl', function(req, res) {
  var url = new Buffer(req.query.path, 'base64').toString('ascii');
  var filename = url.substr(url.lastIndexOf('/') + 1);

  console.log('Downloading: ', url)

  fs.readFile('cache/' + req.query.sha, function(err, data) {
    if (err) {
      request({
        url: url,
        method: req.method,
        encoding: null
      }, function (e, r, b) {
        if (!e && r.statusCode === 200) {
          res.set('Content-Type', 'application/octet-stream');
          res.set('Content-Disposition', 'attachment; filename=' + filename);

          fs.writeFileSync('cache/' + req.query.sha, b);

          res.end(b, 'binary');
        } else {
          res.status(404).send('');
        }
      });
    } else {
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment; filename=' + filename);

      res.end(data, 'binary');
    }
  });
});





// should cache the json response and use it if the registry is ever down
// only versions that have been downloaded will work though
// could filter all versions based on what files are available

app.all('*', function (req, res) {
  console.log('incoming', req.method, req.url, req.headers)

  request({
    url: 'https://registry.npmjs.org' + req.url,
    method: req.method
  }, function(e, r, b) {
    if (!e && r.statusCode === 200) {

      var data = JSON.parse(b);
      var versions = Object.keys(data.versions);
      versions.forEach(function(ver) {
        data.versions[ver].dist.tarball = parseDist(data.versions[ver].dist);
      })


      res.json(data)
    } else {
      console.error('error', e)
      res.send('asdf')
    }

  });
});


function parseDist(dist) {
  var path = new Buffer(dist.tarball).toString('base64')

  return 'http://localhost/_dl?path=' + path + '&sha=' + dist.shasum
}



app.listen(80, function () {
  console.log('Example app listening on port 80!');
});

