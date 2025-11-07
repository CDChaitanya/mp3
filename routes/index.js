/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, Router) {
    app.use('/api', require('./home.js')(Router()));
    app.use('/api/users', require('./users.js')(Router())); 
    app.use('/api/tasks', require('./tasks.js')(Router()));
};
