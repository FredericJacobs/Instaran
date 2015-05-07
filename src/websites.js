var fs = require('fs');
var http = require('follow-redirects').http;
var csvParser = require('csv-parser');
var Promise = require("bluebird");
var request = Promise.promisify(require("request"));

// Parse arguments
var csvFiles = [ ];

process.argv.forEach(function (val, index, array) {
  var fileExt = val.split('.').pop();
  if (fileExt.indexOf("csv") > -1){
    console.log("Adding " + val + " to the list of files");
    csvFiles.push(val);
  }
});

if (csvFiles.length < 1) {
  console.log("At least one csv file needs to be passed as an argument");
} else {


  var URLs = [];
  for (var i = 0; i < csvFiles.length; i++) {
    console.log (csvFiles[i]);
    fs.createReadStream(csvFiles[i])
      .pipe(csvParser())
      .on('data', function(data) {
        var user = data;
        var username = user.User;
        var URL = user.URL;

        if (typeof URL == 'undefined') {
          console.log("No URL for user "+ username);
          return;
        } else {
          if (URL != "na"){
            URLs.push(URL);
            if (URL === 'www.justinbiebermusic.com'){
              var current = Promise.fulfilled();
              Promise.all(URLs.map(function(url) {
                current = current.then(function() {
                    return validateWebsite(url);
                });
                return current;
              }));
            }
          }
        }
      });
  }
}

function validateWebsite (url){
  return request(url).then(function(data){
    var requestBody = data[0].body;
    if (requestBody.indexOf("10.10.") != -1 || requestBody.indexOf("peyvandha.ir") != -1){
      console.log("It appears that: " + url + " is blocked");
    } else {
      console.log("" + url + " seems accessible");
      console.log(requestBody);
    }
  });
}
