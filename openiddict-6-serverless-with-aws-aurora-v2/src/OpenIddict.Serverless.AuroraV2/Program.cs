using Microsoft.EntityFrameworkCore;
using OpenIddict.Serverless.AuroraV2;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAuthentication();
builder.Services.AddAuthorization();
builder.Services.AddCors();
builder.Services.AddControllers();

builder.Services.AddDbContext<OpenIddictDbContext>(o =>
{
    o.UseNpgsql(builder.Configuration.GetConnectionString("OpenIddictDbContext"));
    o.UseOpenIddict<Guid>(); // https://documentation.openiddict.com/integrations/entity-framework-core#use-a-custom-primary-key-type
});

builder.Services.AddOpenIddict()
    .AddCore(o =>
    {
        o.UseEntityFrameworkCore()
            .UseDbContext<OpenIddictDbContext>()
            .ReplaceDefaultEntities<Guid>(); // https://documentation.openiddict.com/integrations/entity-framework-core#use-a-custom-primary-key-type
    })
    .AddServer(o =>
    {
        o.SetTokenEndpointUris("connect/token");

        o.AllowClientCredentialsFlow();

        o.AddEphemeralEncryptionKey()
            .AddEphemeralSigningKey();

        o.UseAspNetCore()
            .DisableTransportSecurityRequirement() // disable HTTPs because we plan to use lambda with HTTP API Gateway
            .EnableTokenEndpointPassthrough();
    });

// add support for lambda with HTTP API integration
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

var app = builder.Build();

app.UseRouting();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapDefaultControllerRoute();

app.Run();
