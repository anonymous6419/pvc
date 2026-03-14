export const errorHandler = (err, req, res, next) => {
    console.error('--- Error Handler ---');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode).json({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};
