using System.ComponentModel.DataAnnotations;
using Amazon.Lambda.APIGatewayEvents;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddValidation();
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi, options =>
{
    options.PostMarshallResponseFeature = (responseFeature, lambdaResponse, context) =>
    {
        var apiResponse = (APIGatewayHttpApiV2ProxyResponse)lambdaResponse;
        apiResponse.Headers ??= new Dictionary<string, string>();
        apiResponse.Headers["X-Request-Id"] = context.AwsRequestId;
    };
});

var app = builder.Build();

app.MapGet("/", () => "Hello World!");

app.MapPost("/products", (CreateProductRequest request) =>
{
    return Results.Created($"/products/{request.Name}", request);
});

app.Run();

public class CreateProductRequest
{
    [Required] public string Name { get; set; } = "";
    [Range(0.01, 99999)] public decimal Price { get; set; }
}
