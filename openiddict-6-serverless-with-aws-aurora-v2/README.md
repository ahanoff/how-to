nerdctl build -t 231489578107.dkr.ecr.ap-southeast-1.amazonaws.com/openiddict6-serverless-ecr-repository:0.1.0 .
nerdctl push 231489578107.dkr.ecr.ap-southeast-1.amazonaws.com/openiddict6-serverless-ecr-repository:0.1.0




Lambda provides multi-architecture base images. However, the image you build for your function must target only one of the architectures. Lambda does not support functions that use multi-architecture container images.


