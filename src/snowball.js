var fs = require('fs');
var Promise = require("bluebird");
var csvParser = require('csv-parser');
var request = Promise.promisify(require("request"));
var ig = Promise.promisifyAll(require('instagram-node').instagram());
var mongoose = require('mongoose');
var express = require('express');
var app = express();

var csvFiles = [ ];

ig.use({
  client_id:     "API_CLIENT_ID",
  client_secret: "API_SECRET"
});
var igUserSearch = Promise.promisify(ig.user_search);
var igUserFollowers = Promise.promisify(ig.user_followers);
var igUserFollowing = Promise.promisify(ig.user_follows);

mongoose.connect('mongodb://localhost/instablockedDB', function(err){
  if (err) {
    console.log("DB connection error: " + err)
  } else {
    console.log("Connection with DB made")
  }
});

var UserModel = mongoose.model('User',{ username:{type:String, unique:true},
                                        isBlocked:{type:Boolean},
                                        lastChecked:{type:Date, default: Date.now},
                                        followersChecked:{type:Boolean, default: false},
                                        followingChecked:{type:Boolean, default: false},
                                        followers:Array});

var UserModelPromise = Promise.promisifyAll(UserModel);

process.argv.forEach(function (val, index, array) {
  var fileExt = val.split('.').pop();
  if (fileExt.indexOf("csv") > -1){
    console.log("Adding " + val + " to the list of files");
    csvFiles.push(val);
  }
});

function objectToURL(user) {
  return "https://www.instagram.com/"+user.username;
}


app.get('/blocked', function (req, res) {
  UserModel.find({isBlocked:true}, function(err, users) {

    var tableString = "";
    var newArray = users.map(objectToURL);
    for (var i = 0; i < newArray.length; i++){
      tableString = tableString + "<tr>" + "<td>" + users[i].username + "</td>" + "<td>" + "<a href=" +newArray[i] + ">" +newArray[i] + "</href>" +  "</td>"+ "</tr>"
    }

    var response = '<table style="width:100%">' + tableString + '</table>'
    res.send(response);
  });
});

var server = app.listen(3000, function () {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Example app listening at http://%s:%s', host, port);
});


if (csvFiles.length < 1) {
  console.log("At least one csv file needs to be passed as an argument");
} else {

  var csv_usernames = [];

  for (var i = 0; i < csvFiles.length; i++) {
    console.log (csvFiles[i]);
    var objectReadStream = fs.createReadStream(csvFiles[i]).pipe(csvParser());

    objectReadStream.on('data', function(data) {
        var user = data;
        var username = user.Username.replace(/\s+/g, '');;
        if (typeof username == 'undefined') {
          return;
        } else {
          csv_usernames.push(username);
        }
    }).on('end', function(data){
        verifyUsernames(csv_usernames);
        verifyFollowersOfBlockedAccounts();
        verifyFollowingOfBlockedAccounts();
      });
  }
}

function clientError(e) {
    return e.code >= 400 && e.code < 500;
}

function verifyUsernames(usernames) {
  var current = Promise.fulfilled();

  console.log("Verifying status for usernames: " + usernames);

  Promise.all(usernames.map(function(username) {
    current = current.then(function() {
        return isValidAccount(username);
    });
    return current;
  }));
}

function verifyFollowersOfBlockedAccounts () {
  UserModel.find({isBlocked:true}, function(err, users) {
    var current = Promise.fulfilled();

    Promise.all(users.map(function(user) {
      current = current.then(function() {
          return validateAllFollowersOfUser(user.username);
      });
      return current;
      }))
  });

}

function verifyFollowingOfBlockedAccounts () {
  UserModel.find({isBlocked:true}, function(err, users) {
    var current = Promise.fulfilled();

    Promise.all(users.map(function(user) {
      current = current.then(function() {
          return validateAllFollowingOfUser(user.username);
      });
      return current;
      }))
  });

}

function isValidAccount (username) {
  return UserModelPromise.findOne({"username":username}).then(function (fetchedContent){
    if (fetchedContent != null){
      if (username.toLowerCase() == fetchedContent.username.toLowerCase()) {
        console.log("Already checked ")
        return;
        };
    }

    return profilePromiseForUsername(username, false).then(function(contents){
        var body = contents[0].body;

        // Instagram blockpage from the AS we test from consistently returns an iFrame
        // with this string.

        if (body.indexOf("?type=Invalid Site&policy=MainPolicy") > -1){
          console.log("===> User "+ username + " is blocked");
          saveUser(username, true);
        } else {
          try{
            var response = JSON.parse(body);
            console.log("Checking against false-negatives: " + response);
            if (!response) {
              console.log(username +" could not be verified");
            } else {
              saveUser(username, false);
            }
          }catch(e){
            console.log("ERROR parsing results for " + username + " parsed body: "+ body);
            //console.log(e); //error in the above string(in this case,yes)!
          }
        }
      })
      .catch(clientError, function(e){
          console.log(clientError);
        })
  });
}

function validateAllFollowingOfUser(username){
  console.log("Validating all following of " + username);

  var current = Promise.fulfilled();
  return userIdForUsername(username).then(userFollowingPromise).then(function (usernames) {
    return verifyUsernames(usernames);
  });


}

function validateAllFollowersOfUser(username){
  console.log("Validating all followers of " + username);

  var current = Promise.fulfilled();
  return userIdForUsername(username).then(userFollowersPromise).then(function (usernames) {
    return verifyUsernames(usernames);
  });
}

function userIdForUsername(username){
  return igUserSearch(username).then(function(IgAPIResponse){
    var users = IgAPIResponse[0];
    //console.log("Returned users: " + JSON.stringify(users));
    if (users.length > 0) {
      var user = users.shift();
      if (user.username != username) {
        throw "User found on Instagram API doesn't match requested username: " + user.username + " vs " + username;
      } else {
        return user.id;
      }
    } else {
      throw "User " + username + " not found";
    }
  });
}

function userFollowersPromise(userId, pagination, previousUsernames){
  if (previousUsernames == null) {
    previousUsernames = [];
  }
  var options = null;
  var followersPromise;

  if (pagination != null){
    followersPromise = igUserFollowers(userId, {cursor:pagination});
  } else{
    followersPromise = igUserFollowers(userId);
  }

  return followersPromise.then(function (followersPage) {
    var responseBody = followersPage[0];

    for (i = 0; i < responseBody.length; i++){
      previousUsernames.push(responseBody[i].username)
    }

    var pagination = followersPage[1].next_cursor;
    if (pagination != null){
      return userFollowersPromise(userId, pagination, previousUsernames);
    } else {
      console.log("Done loading followers");
      return previousUsernames;
    }
  });
}

function userFollowingPromise(userId, pagination, previousUsernames){
  if (previousUsernames == null) {
    previousUsernames = [];
  }

  var options = null;
  var followersPromise;

  if (pagination != null){
    followersPromise = igUserFollowing(userId, {cursor:pagination});
  } else{
    followersPromise = igUserFollowing(userId);
  }

  return followersPromise.then(function (followersPage) {
    var responseBody = followersPage[0];

    for (i = 0; i < responseBody.length; i++){
      previousUsernames.push(responseBody[i].username)
    }

    var pagination = followersPage[1].next_cursor;
    if (pagination != null){
      return userFollowingPromise(userId, pagination, previousUsernames);
    } else {
      console.log("Done loading following");
      return previousUsernames;
    }
  });
}

function profilePromiseForUsername(username, secure){
  return userIdForUsername(username).then(function(userId) {
    var URL = "i.instagram.com/api/v1/users/" + userId+ "/info/";

    if (secure) {
      return "https://" + URL;
    } else {
      return "http://"  + URL;
    }
  }).then(request);
}

function saveUser(username, isBlocked) {
  UserModel.findOne({"username":username}, function(err, user) {
    if (err) {
      console.log("Error while fetching from DB: " + err);
    } else {
      if (user === null || user === undefined){
        user = new UserModel({ "username": username, "isBlocked":isBlocked});
      }

      user.save(function (err) {
        if (err){
          console.log("Error while saving from DB: " + err);
        } else {
          displayMessageForUser(user);
        }
      });
    }
  });
}

function displayMessageForUser(userSaved) {
  if (userSaved.isBlocked) {
    console.log("==> Saved " + userSaved.username + " as blocked!");
  } else {
    console.log("Saved " + userSaved.username + " as accessible");
  }
}
