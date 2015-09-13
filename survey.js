var
  EventEmitter = require('events').EventEmitter,
  util = require('util'),
  uuid = require('uuid');
  

var Survey = function(question, choices, maxReplies, channelName) {
  EventEmitter.call(this);
  this.id = uuid.v4();
  this.question = question;
  this.choices = choices;
  this.channelName = channelName;
  if (maxReplies) this.maxReplies = maxReplies;
  this.instances = {};
}
util.inherits(Survey, EventEmitter);

Survey.prototype.postReactions = function(slack, ts) {
  var self = this;
  this.choices.forEach(function(choice) {
    slack._apiCall('reactions.add', {
      timestamp: ts,
      channel: self.channelID,
      name: choice.icon
    }, function() {});
  });
};

Survey.prototype.getChoiceByIcon = function(icon) {
  var result;
  this.choices.forEach(function(choice) {
    if (choice.icon === icon) result = choice;
  });
  return result;
}

Survey.prototype.getUserAnswersForInstance = function(ts, userID) {
  var
    result = [],
    instance = this.instances[ts];
  if (instance) {
    instance.forEach(function(response) {
      if (response.responder.id === userID) result.push(response);
    });
  }
  return result;
}

Survey.prototype.findResponseIndex = function(ts, userID, reaction) {
  var
    index = -1,
    instance = this.instances[ts];
  for (var i = 0; i < instance.length; i++) {
    if (instance[i].responder.id === userID && instance[i].answer.icon === reaction) {
      index = i;
    }
  }
  return index;
}

module.exports = Survey;